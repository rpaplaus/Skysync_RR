#!/usr/bin/env python3
"""
Skysync - Conversor de DOCX para JSON Estruturado com Gatilhos Musicais
Fase 6: Refatoração e Higienização do Pipeline de Ingestão.

Requisitos da Fase 6:
1. Limpeza de Resíduos (Filtro Global):
   Ignora qualquer parágrafo que contenha apenas dígitos (números de página isolados '1', '2', '3', etc.).
2. Ingestão da Aba 'Prefácio' (Notas):
   Captura 'Nota sobre a Trilha Sonora de Skyhaven' e 'Nota Editorial' e as aloca no objeto de Prefácio (is_preface=True).
3. Exclusão do Índice Físico:
   Ignora completamente a seção 'Índice' com capítulos, pontilhados e números de página.
4. Ingestão Limpa dos Capítulos:
   A partir do Capítulo 1 ('1: O Salto para o Amanhã'), captura os parágrafos normalmente,
   aplicando a correspondência por 'Exact Triggers' com o offset (N-2) de Coincidência Mágica.
"""

import os
import sys
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple
from docx import Document

# Adiciona o diretório backend ao sys.path para importar os modelos Pydantic
SCRIPT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = SCRIPT_DIR.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.models.book import (
    Book,
    BookMetadata,
    BookSettings,
    Chapter,
    ContentBlock,
    AudioTrigger,
    Track,
    Providers,
    SpotifyProvider,
    PlaybackOptions,
)

# Configura saída do terminal para UTF-8 no Windows
if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# Regex robusta para cabeçalhos de capítulos oficiais:
# Suporta:
# - "1: O Salto para o Amanhã"
# - "Capítulo 1: O Salto para o Amanhã"
# - "Capítulo 1 - O Salto para o Amanhã"
CHAPTER_REGEX = re.compile(
    r"^(?:(?:Cap[ií]tulo|Capitulo|Chapter)\s+(\d+|[IVXLCDM]+)\s*[:.\-]?\s*|(\d{1,2})\s*:\s*)(.+)$",
    re.IGNORECASE,
)


def normalize_match_text(text: str) -> str:
    """Normaliza aspas curvas, apóstrofos, travessões e espaços múltiplos para buscas textuais exatas."""
    replacements = {
        '“': '"',
        '”': '"',
        '«': '"',
        '»': '"',
        '‘': "'",
        '’': "'",
        '—': '-',
        '–': '-',
        '\u00a0': ' ',
    }
    t = text
    for old, new in replacements.items():
        t = t.replace(old, new)
    return " ".join(t.split()).lower()


CLOSING_PUNCTUATION = ('.', '!', '?', '"', '”', '“', '»', '›', "'", '’', '…')
DIALOGUE_DASHES = ('—', '–', '-', '―')


def merge_broken_paragraphs(paragraphs: List[str]) -> List[str]:
    """
    Mescla parágrafos fragmentados por 'hard breaks' (quebras de linha forçadas
    decorrentes da conversão de PDF para DOCX).

    Heurísticas:
    1. Regra de Diálogo:
       Se o parágrafo N+1 iniciar com travessão de diálogo (—, -, –), preserva a quebra,
       a menos que seja absolutamente claro que a linha anterior foi quebrada ao meio
       (ex.: parágrafo N sem pontuação de fechamento/dois-pontos e N+1 continuando com travessão e minúscula).
       Por via de dúvida, preserva a quebra de diálogos.
    2. Regra de Junção:
       Se o parágrafo N NÃO termina com pontuação de fechamento (., !, ?, ", ”, », ...)
       OU se o parágrafo N+1 começa com letra minúscula, concatena N+1 ao final de N
       separando por um espaço simples.
    """
    if not paragraphs:
        return []

    merged: List[str] = []
    for p in paragraphs:
        text = p.strip()
        if not text:
            continue

        if not merged:
            merged.append(text)
            continue

        prev = merged[-1]
        ends_with_closing = prev.endswith(CLOSING_PUNCTUATION)
        starts_with_dash = text.startswith(DIALOGUE_DASHES)

        if starts_with_dash:
            content_after_dash = text.lstrip("—–-― ")
            first_alpha = next((c for c in content_after_dash if c.isalpha()), None)
            is_broken_mid_sentence = (
                not ends_with_closing
                and not prev.endswith(":")
                and first_alpha is not None
                and first_alpha.islower()
            )
            should_merge = is_broken_mid_sentence
        else:
            first_alpha = next((c for c in text if c.isalpha()), None)
            starts_with_lowercase = first_alpha is not None and first_alpha.islower()
            should_merge = (not ends_with_closing) or starts_with_lowercase

        if should_merge:
            merged[-1] = f"{merged[-1]} {text}"
        else:
            merged.append(text)

    return merged


def load_tracks_catalog(catalog_path: Path) -> Dict[str, Any]:
    """Carrega o catálogo de trilhas sonoras com mapeamentos para Spotify e YouTube."""
    if not catalog_path.exists():
        print(f"[AVISO] Catálogo não encontrado em {catalog_path}. Nenhum mapeamento prévio será aplicado.")
        return {}
    with open(catalog_path, "r", encoding="utf-8") as f:
        return json.load(f)


def load_exact_triggers(triggers_path: Path) -> Dict[str, str]:
    """Carrega o arquivo de mapeamento de frases exatas para IDs de música."""
    if not triggers_path.exists():
        print(f"[AVISO] Arquivo de gatilhos exatos não encontrado em {triggers_path}.")
        return {}
    with open(triggers_path, "r", encoding="utf-8") as f:
        return json.load(f)


def resolve_track(track_identifier: str, catalog: Dict[str, Any]) -> Track:
    """Busca a música no catálogo por chave, ID, título ou slug, com fallback inteligente."""
    clean_name = track_identifier.strip()
    matched_data = catalog.get(clean_name)

    # 1. Busca por equivalência case-insensitive, ID, Title ou slug (ex: track-handle-with-care -> Handle With Care)
    if not matched_data:
        slug_title = clean_name.lower().replace("track-", "").replace("-", " ")
        for cat_key, data in catalog.items():
            if (
                cat_key.lower() == clean_name.lower()
                or data.get("id", "").lower() == clean_name.lower()
                or data.get("title", "").lower() == clean_name.lower()
                or cat_key.lower() == slug_title
                or data.get("title", "").lower() == slug_title
            ):
                matched_data = data
                break

    if matched_data:
        prov_data = matched_data.get("providers", {})
        sp_data = prov_data.get("spotify")

        spotify_prov = SpotifyProvider(**sp_data) if sp_data else None

        opts_data = matched_data.get("default_playback_options")
        playback_opts = PlaybackOptions(**opts_data) if opts_data else PlaybackOptions()

        return Track(
            id=matched_data.get("id", f"track-{abs(hash(clean_name)) % 10000:04d}"),
            title=matched_data.get("title", clean_name),
            artist=matched_data.get("artist", "Artista Desconhecido"),
            album=matched_data.get("album"),
            duration_seconds=matched_data.get("duration_seconds"),
            role=matched_data.get("role", "trigger"),
            providers=Providers(spotify=spotify_prov or SpotifyProvider(uri=f"spotify:track:{matched_data.get('id', '')}", id=matched_data.get('id', ''))),
            default_playback_options=playback_opts,
        )

    # 2. Fallback caso a música citada não esteja cadastrada no catálogo
    # Converte slug em título legível se começar com track-
    display_title = clean_name
    if clean_name.lower().startswith("track-"):
        display_title = clean_name[6:].replace("-", " ").title()

    track_slug = re.sub(r"[^a-zA-Z0-9]+", "-", clean_name).strip("-").lower()
    return Track(
        id=f"track-{track_slug}",
        title=display_title,
        artist="Trilha Sonora Original",
        role="trigger",
        providers=Providers(
            spotify=SpotifyProvider(uri=f"spotify:track:{track_slug}", id=track_slug),
        ),
        default_playback_options=PlaybackOptions(),
    )


def parse_docx(
    docx_path: Path,
    catalog_path: Path,
    exact_triggers_path: Optional[Path] = None,
    trigger_offset: int = 2,
    book_title: str = "Skyhaven",
    author: str = "Autor",
) -> Book:
    """
    Processa o DOCX higienizando resíduos de conversão, separando o Prefácio dos
    Capítulos oficiais, descartando o Índice físico e aplicando o offset antecipado aos gatilhos.
    """
    print(f"[*] Abrindo manuscrito: {docx_path}")
    doc = Document(str(docx_path))
    catalog = load_tracks_catalog(catalog_path)
    exact_triggers = load_exact_triggers(exact_triggers_path) if exact_triggers_path else {}

    raw_preface_paragraphs: List[str] = []
    raw_chapters_data: List[Dict[str, Any]] = []

    # Máquina de estados: PREFACE -> INDEX -> CHAPTERS
    pipeline_state = "PREFACE"
    discarded_digit_count = 0
    discarded_index_count = 0

    # Pass 1: Extrai texto agrupando em Prefácio vs Capítulos Oficiais com exclusão do Índice
    for p in doc.paragraphs:
        raw_text = p.text.strip()
        if not raw_text:
            continue

        # Requisito 1: Limpeza de Resíduos (Filtro Global)
        # O documento original possui números de página soltos em parágrafos isolados.
        # O script deve ignorar qualquer parágrafo que contenha apenas dígitos.
        if raw_text.isdigit():
            discarded_digit_count += 1
            continue

        style_name = p.style.name if p.style else ""
        if style_name in ["Title", "Subtitle", "Título"]:
            continue

        # Requisito 3: Exclusão do Índice Físico
        # Identifica a página de 'Índice' e marca início da zona de descarte
        if raw_text.lower() in ["índice", "indice", "sumário", "sumario"]:
            pipeline_state = "INDEX"
            discarded_index_count += 1
            continue

        # Linhas do índice físico com pontilhados e números de página não são válidas no formato Web
        is_index_dotted_line = bool(re.search(r"\.{2,}", raw_text))
        if is_index_dotted_line and pipeline_state != "CHAPTERS":
            discarded_index_count += 1
            continue

        # Requisito 4: Ingestão Limpa dos Capítulos
        chapter_match = CHAPTER_REGEX.match(raw_text)
        is_heading_1 = style_name in ["Heading 1", "Título 1"]

        # Cabeçalho de capítulo oficial detectado (e não é linha de índice)
        if (chapter_match or is_heading_1) and not is_index_dotted_line:
            pipeline_state = "CHAPTERS"

            chap_num = len(raw_chapters_data) + 1
            if chapter_match:
                raw_num = chapter_match.group(1) or chapter_match.group(2)
                if raw_num and raw_num.isdigit():
                    chap_num = int(raw_num)
                clean_title = (
                    chapter_match.group(3).strip()
                    if chapter_match.group(3)
                    else " ".join(raw_text.split())
                )
            else:
                clean_title = " ".join(raw_text.split())

            current_chapter_dict = {
                "number": chap_num,
                "title": clean_title,
                "paragraphs": [],
            }
            raw_chapters_data.append(current_chapter_dict)
            print(f"  [+] Capítulo oficial detectado: {clean_title} (Número {chap_num})")
            continue

        # Roteamento dos parágrafos conforme o estado atual
        if pipeline_state == "PREFACE":
            # Requisito 2: Ingestão da Aba 'Prefácio' (Notas Preliminares)
            raw_preface_paragraphs.append(raw_text)
        elif pipeline_state == "INDEX":
            # Requisito 3: Exclusão do Índice Físico (Ignora sumários e pontilhados)
            discarded_index_count += 1
            continue
        elif pipeline_state == "CHAPTERS":
            # Requisito 4: Ingestão do conteúdo narrativo dos capítulos
            if raw_chapters_data:
                raw_chapters_data[-1]["paragraphs"].append(raw_text)

    print(f"  [✓] Resíduos eliminados: {discarded_digit_count} números de página soltos.")
    print(f"  [✓] Índice físico descartado: {discarded_index_count} linhas ignoradas.")

    # Fase 10: Reconstrução Tipográfica e Heurística de Mesclagem
    # Executa a limpeza de hard breaks no Prefácio e em cada capítulo ANTES dos gatilhos
    preface_raw = raw_preface_paragraphs
    preface_paragraphs = merge_broken_paragraphs(preface_raw)
    for chapter in raw_chapters_data:
        chapter["paragraphs"] = merge_broken_paragraphs(chapter["paragraphs"])
    print(f"  [✓] Heurística de mesclagem aplicada: quebras forçadas limpas no Prefácio e Capítulos.")

    chapters: List[Chapter] = []
    WORDS_PER_PAGE = 250

    # 1. Monta Bloco de Prefácio & Notas Iniciais (is_preface=True)
    if preface_paragraphs:
        preface_blocks: List[ContentBlock] = []
        words_accumulator = 0
        current_page = 1

        for idx, text in enumerate(preface_paragraphs):
            words = len(text.split())
            words_accumulator += words
            if words_accumulator > WORDS_PER_PAGE:
                current_page += 1
                words_accumulator = 0

            preface_blocks.append(
                ContentBlock(
                    id=f"cap-preface-b{idx + 1:03d}",
                    type="paragraph",
                    order=idx + 1,
                    page_hint=current_page,
                    text=text,
                    audio_trigger=None,
                )
            )

        total_pref_words = sum(len(b.text.split()) for b in preface_blocks)
        preface_chapter = Chapter(
            id="cap-preface",
            number=0,
            title="Prefácio & Notas do Manuscrito",
            estimated_read_time_minutes=max(1, round(total_pref_words / 200)),
            is_preface=True,
            content_blocks=preface_blocks,
        )
        chapters.append(preface_chapter)
        print(f"  [✓] Aba Prefácio estruturada com {len(preface_blocks)} blocos de notas limpos.")

    # 2. Processa cada capítulo oficial e orquestra a 'Coincidência Mágica' (Offset N-2)
    for chap_data in raw_chapters_data:
        chap_num = chap_data["number"]
        chap_id = f"cap-{chap_num:02d}"
        chap_title = chap_data["title"]
        paragraphs = chap_data["paragraphs"]

        # Detecta gatilhos musicais por parágrafo
        detected_triggers: List[Tuple[int, Track, str]] = []
        used_tracks_in_chapter: Dict[str, int] = {}

        for p_idx, text in enumerate(paragraphs):
            norm_text = normalize_match_text(text)
            # Janela de dois parágrafos para cobrir quebras de linha duras do manuscrito
            norm_combined = (
                f"{norm_text} {normalize_match_text(paragraphs[p_idx + 1])}"
                if p_idx + 1 < len(paragraphs)
                else norm_text
            )

            matched_track: Optional[Track] = None
            matched_source = ""

            # Prioridade 1: Busca exata via exact_triggers.json
            for phrase, track_id in exact_triggers.items():
                norm_phrase = normalize_match_text(phrase)
                if norm_phrase in norm_text or norm_phrase in norm_combined:
                    matched_track = resolve_track(track_id, catalog)
                    matched_source = f"Gatilho Exato: '{phrase}'"
                    break

            # Prioridade 2: Menções ao catálogo geral
            if not matched_track:
                for cat_title in catalog.keys():
                    norm_cat = normalize_match_text(cat_title)
                    if len(norm_cat) >= 4 and (norm_cat in norm_text or norm_cat in norm_combined):
                        matched_track = resolve_track(cat_title, catalog)
                        matched_source = f"Menção Catálogo: '{cat_title}'"
                        break

            if matched_track:
                # Evita duplicatas excessivas da mesma música em parágrafos contíguos (<= 4 parágrafos)
                last_seen_idx = used_tracks_in_chapter.get(matched_track.id)
                if last_seen_idx is None or (p_idx - last_seen_idx > 4):
                    used_tracks_in_chapter[matched_track.id] = p_idx
                    detected_triggers.append((p_idx, matched_track, matched_source))

        # Monta os ContentBlocks do capítulo
        content_blocks: List[ContentBlock] = []
        words_accumulator = 0
        current_page = 1

        for p_idx, text in enumerate(paragraphs):
            words = len(text.split())
            words_accumulator += words
            if words_accumulator > WORDS_PER_PAGE:
                current_page += 1
                words_accumulator = 0

            block = ContentBlock(
                id=f"{chap_id}-b{p_idx + 1:03d}",
                type="paragraph",
                order=p_idx + 1,
                page_hint=current_page,
                text=text,
                audio_trigger=None,
            )
            content_blocks.append(block)

        # Aplica a Coincidência Mágica: Antecipação com offset N - trigger_offset (limite >= 0)
        for orig_idx, track, source_desc in detected_triggers:
            target_idx = max(0, orig_idx - trigger_offset)

            # Procura o bloco livre mais próximo caso o alvo já possua gatilho
            candidate_idx = target_idx
            while candidate_idx > 0 and content_blocks[candidate_idx].audio_trigger is not None:
                candidate_idx -= 1
            if content_blocks[candidate_idx].audio_trigger is not None:
                candidate_idx = target_idx
                while candidate_idx < len(content_blocks) and content_blocks[candidate_idx].audio_trigger is not None:
                    candidate_idx += 1
            if candidate_idx < len(content_blocks):
                target_idx = candidate_idx

            target_block = content_blocks[target_idx]
            target_block.audio_trigger = AudioTrigger(
                trigger_id=f"trg-{chap_id}-b{target_idx + 1:03d}",
                action="PLAY_TRACK",
                delay_ms=1500,
                track=track,
                playback_options=track.default_playback_options,
            )

            print(
                f"    [♪ Coincidência Mágica] '{track.title}' detectado no §{orig_idx + 1} ({source_desc}) "
                f"-> Sincronizado antecipadamente no §{target_idx + 1} (Offset -{trigger_offset})"
            )

        total_words = sum(len(b.text.split()) for b in content_blocks)
        chapter_obj = Chapter(
            id=chap_id,
            number=chap_num,
            title=chap_title,
            estimated_read_time_minutes=max(1, round(total_words / 200)),
            is_preface=False,
            content_blocks=content_blocks,
        )
        chapters.append(chapter_obj)

    # Total de capítulos oficiais (excluindo prefácio)
    official_chapters_count = sum(1 for c in chapters if not c.is_preface)

    book_metadata = BookMetadata(
        id="skysync-skyhaven-vol1",
        title=book_title,
        subtitle="Crônicas do Éter",
        author=author,
        version="1.0-mvp",
        total_chapters=official_chapters_count,
        created_at=datetime.now(timezone.utc).isoformat(),
    )

    book = Book(
        book_metadata=book_metadata,
        settings=BookSettings(
            default_trigger_delay_ms=1500,
            default_fade_duration_ms=2000,
            default_volume=0.85,
        ),
        chapters=chapters,
    )
    return book


def main():
    import argparse

    parser = argparse.ArgumentParser(
        description="Skysync DOCX to JSON Parser (Fase 6: Refatoração e Limpeza da Ingestão)"
    )
    parser.add_argument(
        "--input",
        "-i",
        type=Path,
        default=BACKEND_DIR / "data" / "raw" / "Skyhaven.docx",
        help="Caminho para o manuscrito .docx original.",
    )
    parser.add_argument(
        "--output",
        "-o",
        type=Path,
        default=BACKEND_DIR / "data" / "processed" / "skysync_data.json",
        help="Caminho onde será salvo o JSON estruturado gerado.",
    )
    parser.add_argument(
        "--catalog",
        "-c",
        type=Path,
        default=SCRIPT_DIR / "tracks_catalog.json",
        help="Caminho para o catálogo de faixas (Spotify/YouTube).",
    )
    parser.add_argument(
        "--exact",
        "-e",
        type=Path,
        default=SCRIPT_DIR / "exact_triggers.json",
        help="Caminho para os gatilhos exatos (exact_triggers.json).",
    )
    parser.add_argument(
        "--offset",
        type=int,
        default=2,
        help="Número de parágrafos para antecipação do gatilho (default: 2).",
    )
    parser.add_argument("--title", default="Skyhaven", help="Título da obra.")
    parser.add_argument("--author", default="Autor de Skyhaven", help="Autor da obra.")

    args = parser.parse_args()

    if not args.input.exists():
        fallback_input = BACKEND_DIR / "data" / "raw" / "skyhaven.docx"
        if fallback_input.exists():
            args.input = fallback_input
        else:
            print(f"[ERRO] Manuscrito de entrada não encontrado: {args.input}")
            sys.exit(1)

    args.output.parent.mkdir(parents=True, exist_ok=True)

    book = parse_docx(
        docx_path=args.input,
        catalog_path=args.catalog,
        exact_triggers_path=args.exact,
        trigger_offset=args.offset,
        book_title=args.title,
        author=args.author,
    )

    with open(args.output, "w", encoding="utf-8") as f:
        f.write(book.model_dump_json(indent=2))

    print(f"\n[SUCESSO] Processamento da Fase 6 concluído com êxito!")
    print(f"Total de Seções (Prefácio + Capítulos): {len(book.chapters)}")
    official_count = sum(1 for c in book.chapters if not c.is_preface)
    print(f"Total de Capítulos Oficiais: {official_count}")
    total_triggers = sum(
        1 for c in book.chapters for b in c.content_blocks if b.audio_trigger is not None
    )
    print(f"Total de Gatilhos Musicais Sincronizados: {total_triggers}")
    print(f"Arquivo gerado salvo em: {args.output.resolve()}\n")


if __name__ == "__main__":
    main()
