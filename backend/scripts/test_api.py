#!/usr/bin/env python3
"""
Teste automatizado de integridade dos endpoints da Skysync API (Fase 5).
"""

import sys
from pathlib import Path
from fastapi.testclient import TestClient

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.main import app

client = TestClient(app)


def test_endpoints():
    print("[*] Iniciando bateria de testes dos endpoints Skysync...")

    # 1. Health check
    res = client.get("/health")
    assert res.status_code == 200, f"Erro /health: {res.text}"
    print(f"  [OK] /health -> {res.json()}")

    # 2. Book overview
    res = client.get("/api/v1/book/overview")
    assert res.status_code == 200, f"Erro /api/v1/book/overview: {res.text}"
    data = res.json()
    assert data["metadata"]["title"] == "Skyhaven"
    assert len(data["chapters"]) >= 2
    print(f"  [OK] /api/v1/book/overview -> Livro: '{data['metadata']['title']}', Capítulos/Seções: {len(data['chapters'])}")

    # 3. Full book
    res = client.get("/api/v1/book")
    assert res.status_code == 200, f"Erro /api/v1/book: {res.text}"
    book = res.json()
    total_triggers = sum(
        1 for c in book["chapters"] for b in c["content_blocks"] if b.get("audio_trigger")
    )
    assert total_triggers > 0
    print(f"  [OK] /api/v1/book -> Sucesso. Total de {total_triggers} gatilhos de áudio identificados.")

    # 4. Specific chapter (Capítulo 1)
    res = client.get("/api/v1/chapters/cap-01")
    assert res.status_code == 200, f"Erro /api/v1/chapters/cap-01: {res.text}"
    cap1 = res.json()
    assert cap1["number"] == 1
    print(f"  [OK] /api/v1/chapters/cap-01 -> Título: '{cap1['title']}' (Blocos: {len(cap1['content_blocks'])})")

    # 5. Prefácio
    res = client.get("/api/v1/chapters/cap-preface")
    if res.status_code == 200:
        pref = res.json()
        print(f"  [OK] /api/v1/chapters/cap-preface -> Prefácio carregado com {len(pref['content_blocks'])} notas.")

    # 6. Tracks catalog (100% Exclusivo Spotify)
    res = client.get("/api/v1/tracks/catalog")
    assert res.status_code == 200, f"Erro /api/v1/tracks/catalog: {res.text}"
    catalog = res.json()
    assert "Handle With Care" in catalog
    assert "youtube" not in str(catalog).lower(), "Aviso: YouTube detectado no catálogo!"
    print(f"  [OK] /api/v1/tracks/catalog -> {len(catalog)} faixas cadastradas no catálogo (100% Spotify).")

    # 7. Auth Status & Login endpoint check
    res = client.get("/api/v1/auth/status")
    assert res.status_code == 200, f"Erro /api/v1/auth/status: {res.text}"
    auth_info = res.json()
    print(f"  [OK] /api/v1/auth/status -> Configurado: {auth_info['is_configured']}, Scopes: '{auth_info['scopes']}'")

    # 8. Landing page / Root index
    res = client.get("/")
    assert res.status_code == 200
    assert "spotify-player.js" in res.text
    assert "youtube-adapter.js" not in res.text
    print("  [OK] / -> Frontend index.html servido com sucesso (Spotify SDK integrado).")

    # 9. Fase 18: Cache-Busting HTTP Headers
    for path in ["/api/v1/tracks_catalog.json", "/api/v1/skysync_data.json", "/tracks_catalog.json", "/skysync_data.json"]:
        res = client.get(path)
        assert res.status_code == 200, f"Erro ao acessar {path}: {res.status_code}"
        cc = res.headers.get("cache-control", "").lower()
        pragma = res.headers.get("pragma", "").lower()
        expires = res.headers.get("expires", "")
        assert "no-cache" in cc and "no-store" in cc and "must-revalidate" in cc, f"{path} Cache-Control incorreto: {cc}"
        assert pragma == "no-cache", f"{path} Pragma incorreto: {pragma}"
        assert expires == "0", f"{path} Expires incorreto: {expires}"
        print(f"  [OK] {path} -> Headers anti-cache validados (Cache-Control: {cc}, Pragma: {pragma}, Expires: {expires})")

    print("\n[TODOS OS TESTES PASSARAM COM SUCESSO! 100% FUNCIONAL - SPOTIFY EXCLUSIVE]")



if __name__ == "__main__":
    test_endpoints()
