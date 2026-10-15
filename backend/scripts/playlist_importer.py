#!/usr/bin/env python3
"""
Skysync - Script de Ingestão da Playlist Oficial (playlist_importer.py)

Lê a playlist oficial em texto bruto ('raw_playlist.txt'), extrai título e artista,
cruza com o mapeamento de gatilhos ('exact_triggers.json') através de track-id normalizado,
classifica as faixas em 'trigger' ou 'ambient' e gera o catálogo 'tracks_catalog.json'
estruturado para o PlayerManager com providers preparados para YouTube e Spotify.
"""

import os
import sys
import json
import re
import unicodedata
import argparse
from pathlib import Path
from typing import Dict, Any, List, Optional, Set, Tuple

# Configura saída do terminal para UTF-8 no Windows
if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def to_base_slug(text: str) -> str:
    """
    Converte um texto em slug base:
    - Normaliza caracteres acentuados (NFKD para ASCII).
    - Remove apóstrofos e aspas para manter integridade das contrações (ex: "you'll" -> "youll", "can't" -> "cant").
    - Substitui pontuações e caracteres não alfanuméricos por hífens.
    - Remove hífens duplicados e extremidades.
    - Adiciona o prefixo 'track-'.
    """
    # Decompõe acentos e caracteres especiais
    normalized = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("utf-8")
    
    # Remove aspas e apóstrofos diretos e curvos antes da substituição por hífen
    for quote in ["'", "’", "“", "”", '"', "‘", "`"]:
        normalized = normalized.replace(quote, "")
    
    # Substitui qualquer caractere não alfanumérico por hífen
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", normalized).strip("-").lower()
    return f"track-{slug}"


def generate_track_id(title: str, valid_trigger_ids: Optional[Set[str]] = None) -> str:
    """
    Gera o identificador normalizado da faixa (ex: 'track-handle-with-care')
    a partir do título extraído da playlist.

    Se uma lista/conjunto de valid_trigger_ids de exact_triggers.json for fornecida,
    aplica resoluções heurísticas para garantir o cruzamento com IDs existentes:
    1. Correspondência direta do slug base.
    2. Supressão de parênteses/subtítulos adicionais (ex: 'Succession (Main Title Theme)' -> 'track-succession').
    3. Supressão de artigos iniciais (ex: 'The Morning After' -> 'track-morning-after').
    4. Supressão de sufixos de versão/numeração (ex: 'Chelsea Hotel No. 2' -> 'track-chelsea-hotel').
    5. Prefixo canônico contra IDs de gatilho existentes (ex: 'Can't Help Falling In Love' -> 'track-cant-help-falling').
    """
    base_id = to_base_slug(title)
    if not valid_trigger_ids:
        return base_id

    # 1. Correspondência direta
    if base_id in valid_trigger_ids:
        return base_id

    # 2. Remoção de informações entre parênteses
    no_parens = re.sub(r"\(.*?\)", "", title).strip()
    if no_parens and to_base_slug(no_parens) in valid_trigger_ids:
        return to_base_slug(no_parens)

    # 3. Remoção de artigo 'The ' no início
    if title.lower().startswith("the "):
        without_the = title[4:].strip()
        if to_base_slug(without_the) in valid_trigger_ids:
            return to_base_slug(without_the)

    # 4. Remoção de sufixos como 'No. 2', '#2', 'Part 1', etc.
    no_number = re.sub(r"\b(no\.?\s*\d+|\#\d+|pt\.?\s*\d+|part\s*\d+)\b", "", title, flags=re.IGNORECASE).strip()
    if no_number and to_base_slug(no_number) in valid_trigger_ids:
        return to_base_slug(no_number)

    # 5. Prefixo mais longo correspondente em valid_trigger_ids
    for vid in sorted(valid_trigger_ids, key=len, reverse=True):
        if base_id.startswith(vid + "-"):
            return vid

    return base_id


def load_exact_triggers(triggers_path: Path) -> Tuple[Dict[str, str], Set[str]]:
    """
    Carrega o arquivo exact_triggers.json.
    Retorna o dicionário de frases->track_id e o conjunto de track_ids únicos.
    """
    if not triggers_path.exists():
        raise FileNotFoundError(f"Arquivo de gatilhos exatos não encontrado em: {triggers_path}")

    with open(triggers_path, "r", encoding="utf-8") as f:
        triggers_map: Dict[str, str] = json.load(f)

    unique_ids: Set[str] = set(triggers_map.values())
    return triggers_map, unique_ids


def parse_raw_playlist(playlist_path: Path) -> List[Tuple[str, str]]:
    """
    Lê o arquivo raw_playlist.txt onde cada linha tem o formato 'Título da Música - Artista'.
    Retorna uma lista de tuplas (título, artista).
    """
    if not playlist_path.exists():
        raise FileNotFoundError(f"Arquivo de playlist não encontrado em: {playlist_path}")

    tracks: List[Tuple[str, str]] = []
    with open(playlist_path, "r", encoding="utf-8") as f:
        for line_num, raw_line in enumerate(f, start=1):
            line = raw_line.strip()
            if not line or line.startswith("#"):
                continue

            if " - " in line:
                parts = line.split(" - ", 1)
                title = parts[0].strip()
                artist = parts[1].strip()
            else:
                # Fallback caso haja hífen sem espaços
                parts = line.split("-", 1)
                title = parts[0].strip()
                artist = parts[1].strip() if len(parts) > 1 else "Artista Desconhecido"

            if title:
                tracks.append((title, artist))

    return tracks


def load_existing_catalog(catalog_path: Path) -> Dict[str, Any]:
    """Carrega o catálogo existente caso disponível para reaproveitamento de video_ids configurados."""
    if not catalog_path.exists():
        return {}
    try:
        with open(catalog_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        print(f"[AVISO] Não foi possível ler catálogo existente em {catalog_path}: {e}")
        return {}


def build_catalog(
    playlist_items: List[Tuple[str, str]],
    trigger_ids: Set[str],
    existing_catalog: Optional[Dict[str, Any]] = None,
    preserve_existing_providers: bool = False,
) -> Dict[str, Any]:
    """
    Gera o dicionário de catálogo no formato esperado pelo PlayerManager.

    Para cada faixa:
    - id: track-id normalizado
    - title: título extraído
    - artist: artista extraído
    - role: 'trigger' se o track-id existir em exact_triggers.json, senão 'ambient'
    - providers: YouTube com video_id vazio/placeholder (ou reaproveitado se preserve_existing_providers=True)
                 e Spotify com estrutura base
    - default_playback_options: volume e configurações adequadas
    """
    catalog: Dict[str, Any] = {}
    existing_catalog = existing_catalog or {}

    for title, artist in playlist_items:
        track_id = generate_track_id(title, trigger_ids)
        role = "trigger" if track_id in trigger_ids else "ambient"

        # Tenta recuperar dados existentes se solicitado
        matched_existing: Optional[Dict[str, Any]] = None
        if preserve_existing_providers:
            # Busca por título exato ou ID correspondente no catálogo existente
            matched_existing = existing_catalog.get(title)
            if not matched_existing:
                for existing_key, existing_val in existing_catalog.items():
                    if (
                        existing_val.get("id") == track_id
                        or existing_key.lower() == title.lower()
                        or existing_val.get("title", "").lower() == title.lower()
                    ):
                        matched_existing = existing_val
                        break

        # Estrutura de providers
        if matched_existing and preserve_existing_providers:
            existing_providers = matched_existing.get("providers", {})
            existing_yt = existing_providers.get("youtube", {})
            existing_sp = existing_providers.get("spotify", {})

            youtube_data = {
                "video_id": existing_yt.get("video_id", ""),
                "start_seconds": existing_yt.get("start_seconds", 0),
            }
            spotify_data = {
                "uri": existing_sp.get("uri", ""),
                "id": existing_sp.get("id", ""),
                "preview_url": existing_sp.get("preview_url", None),
            }
            album = matched_existing.get("album", None)
            duration_seconds = matched_existing.get("duration_seconds", None)
        else:
            # Estrutura vazia/placeholder padrão para preenchimento manual posterior
            youtube_data = {
                "video_id": "",
                "start_seconds": 0,
            }
            spotify_data = {
                "uri": "",
                "id": "",
                "preview_url": None,
            }
            album = None
            duration_seconds = None

        # Opções de reprodução: ambient tem loop=false para permitir transição contínua na rádio
        default_playback_options = {
            "fade_in_ms": 4000,
            "volume": 0.85 if role == "trigger" else 0.75,
            "loop": False,
        }

        track_entry = {
            "id": track_id,
            "title": title,
            "artist": artist,
            "album": album,
            "duration_seconds": duration_seconds,
            "role": role,
            "providers": {
                "spotify": spotify_data,
                "youtube": youtube_data,
            },
            "default_playback_options": default_playback_options,
        }

        catalog[title] = track_entry

    return catalog


def save_catalog(catalog: Dict[str, Any], output_path: Path) -> None:
    """Salva o catálogo em formato JSON formatado com UTF-8."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(catalog, f, indent=2, ensure_ascii=False)
        f.write("\n")


def resolve_default_paths() -> Tuple[Path, Path, Path]:
    """Resolve caminhos padrão dos arquivos considerando o layout do projeto Skysync."""
    script_dir = Path(__file__).resolve().parent
    backend_dir = script_dir.parent
    project_root = backend_dir.parent

    # 1. raw_playlist.txt
    cand_playlist = [
        backend_dir / "data" / "raw" / "raw_playlist.txt",
        project_root / "backend" / "data" / "raw" / "raw_playlist.txt",
        script_dir / "raw_playlist.txt",
        Path.cwd() / "raw_playlist.txt",
    ]
    playlist_path = next((p for p in cand_playlist if p.exists()), cand_playlist[0])

    # 2. exact_triggers.json
    cand_triggers = [
        script_dir / "exact_triggers.json",
        backend_dir / "scripts" / "exact_triggers.json",
        project_root / "backend" / "scripts" / "exact_triggers.json",
        Path.cwd() / "exact_triggers.json",
    ]
    triggers_path = next((p for p in cand_triggers if p.exists()), cand_triggers[0])

    # 3. tracks_catalog.json (saída padrão)
    output_path = script_dir / "tracks_catalog.json"

    return playlist_path, triggers_path, output_path


def main() -> None:
    default_playlist, default_triggers, default_output = resolve_default_paths()

    parser = argparse.ArgumentParser(
        description="Skysync - Ingestão da Trilha Sonora Oficial para tracks_catalog.json"
    )
    parser.add_argument(
        "--playlist",
        "-p",
        type=Path,
        default=default_playlist,
        help=f"Caminho para raw_playlist.txt (Padrão: {default_playlist})",
    )
    parser.add_argument(
        "--triggers",
        "-t",
        type=Path,
        default=default_triggers,
        help=f"Caminho para exact_triggers.json (Padrão: {default_triggers})",
    )
    parser.add_argument(
        "--output",
        "-o",
        type=Path,
        default=default_output,
        help=f"Caminho de saída para tracks_catalog.json (Padrão: {default_output})",
    )
    parser.add_argument(
        "--preserve-existing",
        action="store_true",
        default=True,
        help="Reaproveita video_ids e metadados já preenchidos no arquivo de saída existente (Padrão: True).",
    )

    args = parser.parse_args()

    print("=" * 70)
    print(" 🎵 SKYHAVEN / SKYSYNC - INGESTÃO DA TRILHA SONORA OFICIAL")
    print("=" * 70)
    print(f"[*] Playlist Bruta:     {args.playlist}")
    print(f"[*] Gatilhos Exatos:    {args.triggers}")
    print(f"[*] Catálogo de Saída:  {args.output}")
    print(f"[*] Preservar Existente:{args.preserve_existing}")
    print("-" * 70)

    # 1. Carrega gatilhos
    _, trigger_ids = load_exact_triggers(args.triggers)
    print(f"[✓] {len(trigger_ids)} track-ids únicos identificados em exact_triggers.json.")

    # 2. Carrega playlist bruta
    playlist_items = parse_raw_playlist(args.playlist)
    print(f"[✓] {len(playlist_items)} músicas lidas de raw_playlist.txt.")

    # 3. Carrega catálogo existente caso solicitado
    existing_catalog = load_existing_catalog(args.output) if args.preserve_existing else {}
    if existing_catalog:
        print(f"[i] Catálogo existente carregado com {len(existing_catalog)} faixas para mesclagem.")

    # 4. Constrói o catálogo
    catalog = build_catalog(
        playlist_items=playlist_items,
        trigger_ids=trigger_ids,
        existing_catalog=existing_catalog,
        preserve_existing_providers=args.preserve_existing,
    )

    # 5. Salva catálogo gerado
    save_catalog(catalog, args.output)

    # Estatísticas
    trigger_tracks = [t for t in catalog.values() if t["role"] == "trigger"]
    ambient_tracks = [t for t in catalog.values() if t["role"] == "ambient"]

    print("-" * 70)
    print(f"[✓] Catálogo gerado com sucesso em: {args.output}")
    print(f"    • Total de faixas processadas: {len(catalog)}")
    print(f"    • Faixas classificadas como 'trigger': {len(trigger_tracks)}")
    print(f"    • Faixas classificadas como 'ambient': {len(ambient_tracks)}")
    print("=" * 70)
    print("Lista de Faixas Ambientais Oficiais para Rádio Contínua:")
    for idx, t in enumerate(ambient_tracks, start=1):
        print(f"  {idx:02d}. {t['title']} - {t['artist']} [{t['id']}]")
    print("=" * 70)


if __name__ == "__main__":
    main()
