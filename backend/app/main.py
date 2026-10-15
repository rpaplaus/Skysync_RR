import sys
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

# Garante que o diretório backend esteja no path de execução
CURRENT_FILE = Path(__file__).resolve()
BACKEND_DIR = CURRENT_FILE.parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.core.config import (
    APP_TITLE,
    APP_DESCRIPTION,
    APP_VERSION,
    FRONTEND_DIR,
)
from app.api.routes import router as api_router

app = FastAPI(
    title=APP_TITLE,
    description=APP_DESCRIPTION,
    version=APP_VERSION,
    docs_url="/docs",
    redoc_url="/redoc",
)

# Configuração de CORS para permitir consumo pelo leitor frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Registro das rotas da API
app.include_router(api_router)


@app.get("/health", tags=["Sistema"])
@app.get("/api/v1/health", tags=["Sistema"])
def health_check():
    """Endpoint de verificação de integridade da API."""
    return {
        "status": "online",
        "app": "Skysync",
        "version": APP_VERSION,
    }


# Se o diretório do frontend contiver index.html, monta arquivos estáticos
frontend_index = FRONTEND_DIR / "index.html"
if FRONTEND_DIR.exists() and frontend_index.exists():
    app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")
    
    css_dir = FRONTEND_DIR / "css"
    if css_dir.exists():
        app.mount("/css", StaticFiles(directory=str(css_dir)), name="css")
        
    js_dir = FRONTEND_DIR / "js"
    if js_dir.exists():
        app.mount("/js", StaticFiles(directory=str(js_dir)), name="js")

    @app.get("/", include_in_schema=False)
    def serve_frontend_root():
        from fastapi.responses import FileResponse
        return FileResponse(str(frontend_index))
else:
    # Landing page provisória elegante para guiar o desenvolvedor/Tech Lead
    @app.get("/", response_class=HTMLResponse, include_in_schema=False)
    def landing_page():
        return """
        <!DOCTYPE html>
        <html lang="pt-BR">
        <head>
            <meta charset="UTF-8">
            <title>Skysync API - Skyhaven</title>
            <style>
                body {
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                    background: #0f141c;
                    color: #e2e8f0;
                    margin: 0;
                    padding: 40px 20px;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                }
                .card {
                    background: #1a2230;
                    border: 1px solid #2d3748;
                    border-radius: 12px;
                    padding: 32px;
                    max-width: 650px;
                    box-shadow: 0 10px 25px rgba(0,0,0,0.4);
                }
                h1 { color: #63b3ed; margin-top: 0; }
                .badge {
                    display: inline-block;
                    background: #2b6cb0;
                    color: white;
                    padding: 4px 10px;
                    border-radius: 999px;
                    font-size: 0.8rem;
                    font-weight: 600;
                    margin-bottom: 16px;
                }
                a { color: #63b3ed; text-decoration: none; font-weight: 500; }
                a:hover { text-decoration: underline; }
                ul { line-height: 1.8; }
                code {
                    background: #111722;
                    padding: 3px 6px;
                    border-radius: 4px;
                    color: #feb2b2;
                    font-size: 0.9em;
                }
            </style>
        </head>
        <body>
            <div class="card">
                <span class="badge">Backend Ativo</span>
                <h1>🌌 Skysync API (Skyhaven)</h1>
                <p>O servidor backend do <strong>Skysync</strong> está em execução e pronto para servir o leitor.</p>
                <hr style="border: 0; border-top: 1px solid #2d3748; margin: 20px 0;">
                <h3>Recursos Disponíveis:</h3>
                <ul>
                    <li><a href="/docs" target="_blank">Documentação Interativa Swagger (/docs)</a></li>
                    <li><a href="/redoc" target="_blank">Documentação ReDoc (/redoc)</a></li>
                    <li><a href="/api/v1/book" target="_blank">JSON Completo do Livro (<code>/api/v1/book</code>)</a></li>
                    <li><a href="/api/v1/book/overview" target="_blank">Sumário e Capítulos (<code>/api/v1/book/overview</code>)</a></li>
                    <li><a href="/api/v1/tracks/catalog" target="_blank">Catálogo de Músicas (<code>/api/v1/tracks/catalog</code>)</a></li>
                </ul>
            </div>
        </body>
        </html>
        """


if __name__ == "__main__":
    import uvicorn
    import os
    server_port = int(os.getenv("PORT", 8080))
    uvicorn.run("app.main:app", host="127.0.0.1", port=server_port, reload=True)
