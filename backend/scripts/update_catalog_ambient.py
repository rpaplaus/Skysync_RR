import json
from pathlib import Path

catalog_path = Path(__file__).resolve().parent / "tracks_catalog.json"
data_path = Path(__file__).resolve().parent.parent / "data" / "processed" / "skysync_data.json"

with open(catalog_path, "r", encoding="utf-8") as f:
    catalog = json.load(f)

ambients = {
    "Neon Solitude": {
        "id": "track-ambient-neon-solitude",
        "title": "Neon Solitude",
        "artist": "Aether Lofi Beats",
        "album": "Skyhaven Ambient Sessions",
        "duration_seconds": 240,
        "role": "ambient",
        "providers": {
            "spotify": {"uri": "spotify:track:4cOdK2wGLETKBW3PvgPWqT", "id": "4cOdK2wGLETKBW3PvgPWqT"}
        },
        "default_playback_options": {"fade_in_ms": 4000, "volume": 0.85, "loop": True}
    },
    "Cyber Drizzle": {
        "id": "track-ambient-cyber-drizzle",
        "title": "Cyber Drizzle",
        "artist": "Synthwave Nocturne",
        "album": "Skyhaven Ambient Sessions",
        "duration_seconds": 300,
        "role": "ambient",
        "providers": {
            "spotify": {"uri": "spotify:track:0VjIjW4GlUZAMYd2vXMi3b", "id": "0VjIjW4GlUZAMYd2vXMi3b"}
        },
        "default_playback_options": {"fade_in_ms": 4000, "volume": 0.85, "loop": True}
    },
    "Aetherium Horizons": {
        "id": "track-ambient-aetherium-horizons",
        "title": "Aetherium Horizons",
        "artist": "Skyhaven Symphony",
        "album": "Skyhaven Ambient Sessions",
        "duration_seconds": 280,
        "role": "ambient",
        "providers": {
            "spotify": {"uri": "spotify:track:3AJwUDP919kvQ9QcozQPxg", "id": "3AJwUDP919kvQ9QcozQPxg"}
        },
        "default_playback_options": {"fade_in_ms": 4000, "volume": 0.85, "loop": True}
    },
    "Midnight Starlight": {
        "id": "track-ambient-midnight-starlight",
        "title": "Midnight Starlight",
        "artist": "Kaelen & The Cloud Cadets",
        "album": "Skyhaven Ambient Sessions",
        "duration_seconds": 260,
        "role": "ambient",
        "providers": {
            "spotify": {"uri": "spotify:track:2takcwOaAZWiRQiNXNZqn5", "id": "2takcwOaAZWiRQiNXNZqn5"}
        },
        "default_playback_options": {"fade_in_ms": 4000, "volume": 0.85, "loop": True}
    }
}

for k, v in ambients.items():
    catalog[k] = v
    print(f"[+] Spotify Ambient Track: {k} -> {v['providers']['spotify']['uri']}")

with open(catalog_path, "w", encoding="utf-8") as f:
    json.dump(catalog, f, indent=2, ensure_ascii=False)

print("[*] Saved tracks_catalog.json with", len(catalog), "tracks (100% Spotify).")
