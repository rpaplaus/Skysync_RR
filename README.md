<p align="center">
  <img src="docs/assets/skyhaven_cover.png" alt="Skyhaven - R. A. Rios" width="360" style="border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,0.5);" />
</p>

# 🌌 Skysync (Skyhaven)

> Plataforma de leitura imersiva com trilha sonora adaptativa sincronizada em tempo real para a obra de ficção científica **Skyhaven** (R. A. Rios).

[![Python](https://img.shields.io/badge/Python-3.10%2B-blue.svg?logo=python&logoColor=white)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.110%2B-009688.svg?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![License](https://img.shields.io/badge/License-Proprietary-purple.svg)](#)
[![Status](https://img.shields.io/badge/Status-100%25%20Funcional-success.svg)](#)

---

## 📖 Visão Geral

O **Skysync** transforma a experiência de leitura do livro *Skyhaven* em uma jornada multimídia imersiva. À medida que o leitor navega pelos capítulos e parágrafos, gatilhos de áudio integrados no texto acionam e sincronizam automaticamente trilhas sonoras atmosféricas oficiais via **Spotify Web Playback SDK**.

> [!NOTE]
> **Dados Já Estruturados no Repositório:**  
> Não é necessário realizar ingestão manual ou processamento de arquivos DOCX. Todos os 26 capítulos estruturados, parágrafos e 55 gatilhos de áudio já se encontram compilados e versionados no repositório em [`backend/data/processed/skysync_data.json`](backend/data/processed/skysync_data.json), e o catálogo de faixas em [`backend/scripts/tracks_catalog.json`](backend/scripts/tracks_catalog.json).

---

## 📁 Estrutura do Projeto

```text
Skyhaven/
├── .vscode/                               # Configurações para Antigravity IDE / VS Code
│   ├── launch.json                        # Perfis de depuração e execução rápida (F5)
│   ├── settings.json                      # Detecção do .venv e preferências da IDE
│   └── tasks.json                         # Tarefas integradas de inicialização e testes
├── backend/
│   ├── app/
│   │   ├── main.py                        # Ponto de entrada: API FastAPI e servidor estático
│   │   ├── api/
│   │   │   └── routes.py                  # Endpoints REST (/book, /chapters, /tracks)
│   │   ├── core/                          # Configurações globais e resolução de paths
│   │   └── models/                        # Schemas Pydantic de validação
│   ├── data/
│   │   └── processed/
│   │       └── skysync_data.json          # Livro completo estruturado com gatilhos de áudio
│   ├── scripts/
│   │   ├── tracks_catalog.json            # Catálogo oficial de faixas Spotify (URIs e IDs)
│   │   └── test_api.py                    # Suite de testes automatizados dos endpoints
│   └── requirements.txt                   # Dependências do backend
├── frontend/                              # Interface do leitor web
│   ├── css/                               # Estilos visuais, temas claro/escuro e layout
│   ├── js/                                # Lógica de leitura, gatilhos de áudio e adapters
│   └── index.html                         # Interface de leitura imersiva
└── docs/
    └── assets/                            # Capa oficial e recursos visuais
```

---

## 🛠️ Pré-requisitos e Ambiente Virtual

Certifique-se de possuir o **Python 3.10+** instalado.

### 1. Criar o Ambiente Virtual (`.venv`)

Na raiz do projeto:

```bash
python -m venv .venv
```

### 2. Ativar o Ambiente Virtual

- **No Windows (PowerShell):**
  ```powershell
  .\.venv\Scripts\Activate.ps1
  ```
  *(Se o PowerShell bloquear a execução de scripts, execute antes:* `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope Process`*)*

- **No Windows (Prompt de Comando - CMD):**
  ```cmd
  .\.venv\Scripts\activate.bat
  ```

- **No Linux / macOS (Bash / Zsh):**
  ```bash
  source .venv/bin/activate
  ```

### 3. Instalar as Dependências

Com o ambiente virtual ativado:

```bash
pip install -r backend/requirements.txt
```

---

## 💻 Como Iniciar pelo Antigravity IDE (ou VS Code)

O projeto já inclui perfis prontos na pasta `.vscode/` para inicialização com apenas 1 clique em IDEs como o **Google Antigravity IDE** ou **VS Code**:

### Método 1: Pelo Menu "Run and Debug" (F5) ⭐ *Recomendado*

1. Abra a pasta do projeto no **Antigravity IDE**.
2. Abra o painel **Run and Debug** na barra lateral esquerda (`Ctrl+Shift+D` ou `Cmd+Shift+D`) ou pressione **`F5`**.
3. Selecione uma das opções configuradas:
   - **`Skysync: Servidor FastAPI (Live Reload)`**: Inicia o servidor backend com *hot-reload* na porta `8000`.
   - **`Skysync: Executar main.py`**: Inicia o servidor executando diretamente `backend/app/main.py`.
   - **`Skysync: Rodar Testes da API`**: Executa a bateria de testes de validação.
4. Clique no ícone verde de **Play** (ou aperte `F5`).

### Método 2: Pelo Menu de Tarefas da IDE (`Ctrl+Shift+B`)

1. Pressione `Ctrl+Shift+B` (ou vá em **Terminal** ➔ **Run Build Task...**).
2. Selecione **`Iniciar Servidor Skysync`**.
3. A IDE inicializará o servidor em background utilizando o interpretador do `.venv`.

### Método 3: Pelo Terminal Integrado da IDE

Graças ao arquivo `.vscode/settings.json`, ao abrir um novo terminal integrado na IDE (`Ctrl+` `), o ambiente virtual `.venv` é ativado automaticamente.

---

## 🚀 Como Iniciar via Linha de Comando (CLI)

Após ativar o `.venv`, você pode iniciar o servidor de duas formas:

### Opção 1: Via Uvicorn (com *Live Reload*)
```bash
uvicorn backend.app.main:app --reload --port 8000
```

### Opção 2: Executando o arquivo principal
```bash
python backend/app/main.py
```

### 🌐 Acessando a Aplicação:
O servidor serve tanto a API quanto a interface visual do leitor:
- **Interface do Leitor (Frontend):** [`http://localhost:8000`](http://localhost:8000)
- **Swagger UI (Documentação Interativa):** [`http://localhost:8000/docs`](http://localhost:8000/docs)
- **ReDoc:** [`http://localhost:8000/redoc`](http://localhost:8000/redoc)

---

## 📡 Endpoints da API

| Método | Endpoint | Descrição |
|:---|:---|:---|
| `GET` | `/` | Interface principal do leitor imersivo (*Frontend*) |
| `GET` | `/health` | Verificação de integridade e status da API |
| `GET` | `/docs` | Documentação interativa Swagger UI |
| `GET` | `/redoc` | Documentação técnica ReDoc |
| `GET` | `/api/v1/book` | Retorna o livro completo com todos os capítulos, parágrafos e gatilhos |
| `GET` | `/api/v1/book/overview` | Sumário (TOC), metadados do livro e contagem de gatilhos |
| `GET` | `/api/v1/chapters/{id}` | Retorna um capítulo específico (ex: `cap-01`, `cap-preface`) |
| `GET` | `/api/v1/auth/login` | Inicia o fluxo de autorização OAuth do Spotify (Authorization Code Flow) |
| `GET` | `/api/v1/auth/callback` | Callback de troca de código por Access Token e redirecionamento |
| `GET` | `/api/v1/auth/status` | Verifica o status da configuração das credenciais do Spotify |
| `GET` | `/api/v1/tracks/catalog` | Catálogo completo de faixas com URIs e IDs para Spotify |

---

## 🧪 Testes Automatizados

O projeto possui uma suíte automatizada que valida a integridade de todas as rotas e a estrutura dos dados:

```bash
python backend/scripts/test_api.py
```

Saída esperada:
```text
[*] Iniciando bateria de testes dos endpoints Skysync...
  [OK] /health -> {'status': 'online', 'app': 'Skysync', 'version': '1.0.0-mvp'}
  [OK] /api/v1/book/overview -> Livro: 'Skyhaven', Capítulos/Seções: 26
  [OK] /api/v1/book -> Sucesso. Total de 55 gatilhos de áudio identificados.
  [OK] /api/v1/chapters/cap-01 -> Título: 'O Salto para o Amanhã' (Blocos: 50)
  [OK] /api/v1/tracks/catalog -> 53 faixas cadastradas no catálogo.
  [OK] / -> Frontend index.html servido com sucesso.

[TODOS OS TESTES PASSARAM COM SUCESSO! 100% FUNCIONAL]
```
