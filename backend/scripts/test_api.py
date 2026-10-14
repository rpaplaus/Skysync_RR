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

    # 6. Tracks catalog
    res = client.get("/api/v1/tracks/catalog")
    assert res.status_code == 200, f"Erro /api/v1/tracks/catalog: {res.text}"
    catalog = res.json()
    assert "Aetherium Dreams" in catalog
    print(f"  [OK] /api/v1/tracks/catalog -> {len(catalog)} faixas cadastradas no catálogo.")

    # 7. Landing page / Root index
    res = client.get("/")
    assert res.status_code == 200
    print("  [OK] / -> Frontend index.html servido com sucesso.")

    print("\n[TODOS OS TESTES PASSARAM COM SUCESSO! 100% FUNCIONAL]")


if __name__ == "__main__":
    test_endpoints()
