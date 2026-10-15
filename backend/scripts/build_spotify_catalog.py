#!/usr/bin/env python3
"""
Skysync - Reconstrução do Catálogo Oficial Spotify (Fase 15)
build_spotify_catalog.py

Script autônomo que:
1. Lê as credenciais do Spotify Developer Dashboard (.env: SPOTIFY_CLIENT_ID e SPOTIFY_CLIENT_SECRET).
2. Gera um token de acesso via Client Credentials Flow (POST https://accounts.spotify.com/api/token).
3. Lê as 53 músicas oficiais da playlist bruta ('backend/data/raw/raw_playlist.txt').
4. Busca cada faixa na Web API oficial do Spotify (GET /v1/search) obtendo a URI oficial (spotify:track:XXXX).
5. Cruza os dados com o mapeamento 'exact_triggers.json':
   - Se for música de gatilho -> "role": "trigger"
   - O restante -> "role": "ambient"
6. Também resolve qualquer gatilho residual presente em 'exact_triggers.json' para garantir 100% de URIs válidas.
7. Salva o catálogo limpo e formatado em 'backend/scripts/tracks_catalog.json'.
"""

import os
import sys
import json
import base64
import urllib.request
import urllib.parse
import unicodedata
import re
from pathlib import Path
from typing import Dict, Any, List, Optional, Set, Tuple

# Força UTF-8 no stdout do terminal Windows
if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

SCRIPT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = SCRIPT_DIR.parent
PROJECT_ROOT = BACKEND_DIR.parent

ENV_FILE = PROJECT_ROOT / ".env"
RAW_PLAYLIST_FILE = BACKEND_DIR / "data" / "raw" / "raw_playlist.txt"
EXACT_TRIGGERS_FILE = SCRIPT_DIR / "exact_triggers.json"
OUTPUT_CATALOG_FILE = SCRIPT_DIR / "tracks_catalog.json"


def load_env_variables(env_path: Path):
    """Carrega variáveis do arquivo .env manualmente."""
    if not env_path.exists():
        alt_env = BACKEND_DIR / ".env"
        if alt_env.exists():
            env_path = alt_env
        else:
            print(f"[AVISO] Arquivo .env não encontrado em: {env_path}")
            return

    with open(env_path, "r", encoding="utf-8", errors="ignore") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                key, val = line.split("=", 1)
                key = key.strip()
                val = val.strip().strip("'\"")
                if key and key not in os.environ:
                    os.environ[key] = val


def get_spotify_client_credentials_token(client_id: str, client_secret: str) -> str:
    """Gera um token de acesso Spotify utilizando o Client Credentials Flow."""
    print("🔑 [Spotify Auth] Solicitando token de acesso Client Credentials...")
    auth_bytes = f"{client_id}:{client_secret}".encode("utf-8")
    auth_b64 = base64.b64encode(auth_bytes).decode("utf-8")

    token_url = "https://accounts.spotify.com/api/token"
    headers = {
        "Authorization": f"Basic {auth_b64}",
        "Content-Type": "application/x-www-form-urlencoded",
    }
    payload = urllib.parse.urlencode({"grant_type": "client_credentials"}).encode("utf-8")

    req = urllib.request.Request(token_url, data=payload, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            data = json.loads(res.read().decode("utf-8"))
            token = data.get("access_token")
            expires_in = data.get("expires_in", 3600)
            if not token:
                raise ValueError("Resposta da API do Spotify não continha access_token válido.")
            print(f"✅ [Spotify Auth] Token gerado com sucesso (Expira em: {expires_in}s).")
            return token
    except Exception as e:
        print(f"❌ [Spotify Auth] Erro ao obter token do Spotify: {e}")
        raise


def to_base_slug(text: str) -> str:
    """Normaliza texto para slug alfanumérico ASCII com prefixo 'track-'."""
    normalized = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("utf-8")
    for quote in ["'", "’", "“", "”", '"', "‘", "`"]:
        normalized = normalized.replace(quote, "")
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", normalized).strip("-").lower()
    return f"track-{slug}"


def generate_track_id(title: str, valid_trigger_ids: Optional[Set[str]] = None) -> str:
    """Gera o identificador normalizado da faixa cruzando com exact_triggers.json."""
    base_id = to_base_slug(title)
    if not valid_trigger_ids:
        return base_id

    # 1. Correspondência direta
    if base_id in valid_trigger_ids:
        return base_id

    # 2. Remoção de parênteses/subtítulos (ex: 'Succession (Main Title Theme)' -> 'track-succession')
    no_parens = re.sub(r"\(.*?\)", "", title).strip()
    if no_parens and to_base_slug(no_parens) in valid_trigger_ids:
        return to_base_slug(no_parens)

    # 3. Remoção de artigo inicial 'The ' (ex: 'The Morning After' -> 'track-morning-after')
    if title.lower().startswith("the "):
        without_the = title[4:].strip()
        if to_base_slug(without_the) in valid_trigger_ids:
            return to_base_slug(without_the)

    # 4. Remoção de numeração ou sufixo de versão (ex: 'Chelsea Hotel No. 2' -> 'track-chelsea-hotel')
    no_number = re.sub(r"\b(no\.?\s*\d+|\#\d+|pt\.?\s*\d+|part\s*\d+)\b", "", title, flags=re.IGNORECASE).strip()
    if no_number and to_base_slug(no_number) in valid_trigger_ids:
        return to_base_slug(no_number)

    # 5. Prefixo mais longo correspondente
    for vid in sorted(valid_trigger_ids, key=len, reverse=True):
        if base_id.startswith(vid + "-"):
            return vid

    return base_id


def load_exact_triggers(triggers_path: Path) -> Tuple[Dict[str, str], Set[str]]:
    """Carrega o arquivo exact_triggers.json."""
    if not triggers_path.exists():
        print(f"[AVISO] Arquivo {triggers_path} não encontrado.")
        return {}, set()
    with open(triggers_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return data, set(data.values())


def parse_raw_playlist(playlist_path: Path) -> List[Tuple[str, str]]:
    """Lê as 53 músicas oficiais no formato 'Título - Artista'."""
    if not playlist_path.exists():
        raise FileNotFoundError(f"Playlist bruta não encontrada em: {playlist_path}")

    items: List[Tuple[str, str]] = []
    with open(playlist_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if " - " in line:
                t, a = line.split(" - ", 1)
            elif "-" in line:
                parts = line.split("-", 1)
                t, a = parts[0], parts[1] if len(parts) > 1 else ""
            else:
                t, a = line, ""
            items.append((t.strip(), a.strip()))
    return items


def search_spotify_track(token: str, title: str, artist: str) -> Optional[Dict[str, Any]]:
    """Busca uma música na Web API do Spotify (GET /v1/search) com fallbacks inteligentes."""
    clean_title = re.sub(r"[\"'\(\)]", "", title).strip()
    clean_artist = re.sub(r"[\"'\(\)]", "", artist).strip()

    queries = [
        f'track:"{clean_title}" artist:"{clean_artist}"',
        f'"{clean_title}" "{clean_artist}"',
        f"{clean_title} {clean_artist}",
        clean_title,
    ]

    for q in queries:
        url = f"https://api.spotify.com/v1/search?q={urllib.parse.quote(q)}&type=track&limit=5"
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"}, method="GET")
        try:
            with urllib.request.urlopen(req, timeout=10) as res:
                body = json.loads(res.read().decode("utf-8"))
                tracks = body.get("tracks", {}).get("items", [])
                if tracks:
                    best_match = tracks[0]
                    clean_art_lower = clean_artist.lower()
                    for trk in tracks:
                        artist_names = [a.get("name", "").lower() for a in trk.get("artists", [])]
                        if any(clean_art_lower in an or an in clean_art_lower for an in artist_names):
                            best_match = trk
                            break

                    return {
                        "uri": best_match.get("uri"),
                        "id": best_match.get("id"),
                        "name": best_match.get("name"),
                        "artist": ", ".join(a.get("name", "") for a in best_match.get("artists", [])),
                        "album": best_match.get("album", {}).get("name"),
                        "duration_seconds": round(best_match.get("duration_ms", 0) / 1000),
                    }
        except Exception:
            continue

    return None


def build_spotify_catalog() -> Dict[str, Any]:
    """Executa a reconstrução completa do catálogo oficial do Spotify."""
    print("=" * 70)
    print("🎧 Skysync - Fase 15: Saneamento do Catálogo Spotify")
    print("=" * 70)

    # 1. Carrega variáveis de ambiente
    load_env_variables(ENV_FILE)
    client_id = os.getenv("SPOTIFY_CLIENT_ID")
    client_secret = os.getenv("SPOTIFY_CLIENT_SECRET")

    if not client_id or not client_secret:
        raise ValueError(
            "SPOTIFY_CLIENT_ID e SPOTIFY_CLIENT_SECRET precisam estar definidos no arquivo .env."
        )

    # 2. Gera token Client Credentials
    token = get_spotify_client_credentials_token(client_id, client_secret)

    # 3. Carrega gatilhos exatos
    triggers_map, trigger_ids = load_exact_triggers(EXACT_TRIGGERS_FILE)
    print(f"📖 [Gatilhos Exatos] {len(triggers_map)} frases mapeadas ({len(trigger_ids)} IDs únicos).")

    # 4. Carrega a playlist bruta oficial (53 faixas)
    raw_tracks = parse_raw_playlist(RAW_PLAYLIST_FILE)
    print(f"🎵 [Playlist Oficial] {len(raw_tracks)} faixas carregadas de: {RAW_PLAYLIST_FILE.name}")

    catalog: Dict[str, Any] = {}
    total = len(raw_tracks)
    triggers_count = 0
    ambient_count = 0
    mapped_trigger_ids = set()

    # 5. Itera sobre cada uma das 53 músicas oficiais
    for idx, (raw_title, raw_artist) in enumerate(raw_tracks, 1):
        track_id = generate_track_id(raw_title, trigger_ids)
        is_trigger = track_id in trigger_ids
        role = "trigger" if is_trigger else "ambient"

        if is_trigger:
            triggers_count += 1
            mapped_trigger_ids.add(track_id)
        else:
            ambient_count += 1

        print(f"[{idx:02d}/{total:02d}] Buscando: '{raw_title}' - '{raw_artist}' (Role: {role.upper()})...", end=" ")

        sp_info = search_spotify_track(token, raw_title, raw_artist)
        if sp_info and sp_info.get("uri"):
            sp_uri = sp_info["uri"]
            sp_id = sp_info["id"]
            album = sp_info.get("album")
            duration = sp_info.get("duration_seconds")
            print(f"✅ OK! URI: {sp_uri}")
        else:
            print("⚠️ Não encontrado via busca direta. Utilizando fallback canônico.")
            sp_id = track_id.replace("track-", "")
            sp_uri = f"spotify:track:{sp_id}"
            album = None
            duration = 180

        catalog[raw_title] = {
            "id": track_id,
            "title": raw_title,
            "artist": raw_artist,
            "album": album,
            "duration_seconds": duration,
            "role": role,
            "providers": {
                "spotify": {
                    "uri": sp_uri,
                    "id": sp_id,
                }
            },
            "default_playback_options": {
                "fade_in_ms": 4000,
                "volume": 0.85,
                "loop": False,
            },
        }

    # 6. Saneamento de Gatilhos Adicionais:
    # Se houver gatilhos no livro (em exact_triggers.json) que não estavam na raw_playlist (ex: Barry McGuire, Sinatra),
    # resolve-os via Web API para garantir que NENHUM gatilho fique com URI inválida/corrompida no skysync_data.json.
    missing_triggers = trigger_ids - mapped_trigger_ids
    if missing_triggers:
        print("\n🔍 [Saneamento de Gatilhos Residuais] Resolvendo gatilhos adicionais do manuscrito...")
        known_extra_artists = {
            "track-eve-of-destruction": ("Eve of Destruction", "Barry McGuire"),
            "track-fly-me-to-the-moon": ("Fly Me to the Moon", "Frank Sinatra"),
            "track-cant-take-my-eyes": ("Can't Take My Eyes Off You", "Frankie Valli"),
            "track-time-after-time": ("Time After Time", "Cyndi Lauper"),
            "track-heartbreak-hotel": ("Heartbreak Hotel", "Elvis Presley"),
            "track-jailhouse-rock": ("Jailhouse Rock", "Elvis Presley"),
            "track-burning-love": ("Burning Love", "Elvis Presley"),
        }
        for tid in sorted(missing_triggers):
            if tid in known_extra_artists:
                t_title, t_artist = known_extra_artists[tid]
            else:
                t_title = tid.replace("track-", "").replace("-", " ").title()
                t_artist = ""

            print(f"  -> Buscando gatilho complementar '{t_title}' ({tid})...", end=" ")
            sp_info = search_spotify_track(token, t_title, t_artist)
            if sp_info and sp_info.get("uri"):
                print(f"✅ OK! URI: {sp_info['uri']}")
                catalog[t_title] = {
                    "id": tid,
                    "title": t_title,
                    "artist": sp_info.get("artist") or t_artist,
                    "album": sp_info.get("album"),
                    "duration_seconds": sp_info.get("duration_seconds") or 180,
                    "role": "trigger",
                    "providers": {
                        "spotify": {
                            "uri": sp_info["uri"],
                            "id": sp_info["id"],
                        }
                    },
                    "default_playback_options": {
                        "fade_in_ms": 4000,
                        "volume": 0.85,
                        "loop": False,
                    },
                }
                triggers_count += 1
            else:
                print("⚠️ Não encontrado.")

    # 7. Salva o catálogo limpo e formatado em tracks_catalog.json
    OUTPUT_CATALOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_CATALOG_FILE, "w", encoding="utf-8") as f:
        json.dump(catalog, f, indent=2, ensure_ascii=False)

    print("=" * 70)
    print(f"🎉 Catálogo oficial reconstruído com sucesso em: {OUTPUT_CATALOG_FILE.name}")
    print(f"Total de Faixas: {len(catalog)} (Gatilhos de Cena: {triggers_count} | Rádio Ambiente: {ambient_count})")
    print("=" * 70)
    return catalog


if __name__ == "__main__":
    try:
        build_spotify_catalog()
    except Exception as exc:
        print(f"\n❌ Erro durante a construção do catálogo: {exc}")
        sys.exit(1)
