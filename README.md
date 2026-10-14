<p align="center">
  <img src="docs/assets/skyhaven_cover.png" alt="Skyhaven - R. A. Rios" width="380" />
</p>

# 🌌 Skysync (Skyhaven)

> Plataforma de leitura imersiva com trilha sonora adaptativa sincronizada.

---

## 🛠️ Requisitos
- Python 3.10+
- Bibliotecas listadas em `backend/requirements.txt`

Instalação rápida das dependências:
```bash
pip install -r backend/requirements.txt
```

---

## 🚀 Como Executar

### 1. Ingestão e Processamento do Manuscrito (DOCX ➔ JSON)

O script `docx_parser.py` lê o manuscrito original em formato `.docx`, detecta os capítulos e identifica as marcações de áudio (via Regex: `[[TRILHA: Nome]]`, `[MÚSICA: Nome]`, `♫ Nome ♫`), associando os links do Spotify e YouTube a partir do catálogo `tracks_catalog.json`.

Para rodar o parser com os caminhos padrão:
```bash
python backend/scripts/docx_parser.py
```

Argumentos opcionais:
```bash
python backend/scripts/docx_parser.py --input backend/data/raw/skyhaven.docx --output backend/data/processed/skysync_data.json --catalog backend/scripts/tracks_catalog.json
```

---

### 2. Iniciar o Servidor FastAPI

Para iniciar o servidor com recarregamento automático (*live reload*):
```bash
uvicorn backend.app.main:app --reload --port 8000
```
*Ou executando diretamente:*
```bash
python backend/app/main.py
```

O servidor estará disponível em: **`http://localhost:8000`**

---

## 📡 Endpoints da API

| Método | Endpoint | Descrição |
|---|---|---|
| `GET` | `/` | Status da aplicação / Landing page |
| `GET` | `/docs` | Documentação interativa Swagger UI |
| `GET` | `/redoc` | Documentação ReDoc |
| `GET` | `/health` | Verificação de integridade |
| `GET` | `/api/v1/book` | Retorna o livro completo com todos os capítulos, parágrafos e gatilhos |
| `GET` | `/api/v1/book/overview` | Sumário (TOC) com metadados e contagem de gatilhos |
| `GET` | `/api/v1/chapters/{id}` | Retorna um capítulo específico (ex: `cap-01`) |
| `GET` | `/api/v1/tracks/catalog` | Catálogo de trilhas mapeadas para Spotify e YouTube |

---

## 🧪 Testes Automatizados

Para rodar a bateria de testes de integridade dos endpoints:
```bash
python backend/scripts/test_api.py
```
