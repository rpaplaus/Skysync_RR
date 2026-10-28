import sys
from pathlib import Path
from fastapi import FastAPI, Response, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, FileResponse
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
    PROJECT_ROOT,
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


# =====================================================================
# Rotas de Arquivos Estáticos e Frontend (Fase 18 / Restauração)
# =====================================================================

def resolve_frontend_dir() -> Path:
    """Busca o diretório frontend em múltiplos caminhos possíveis para máxima resiliência."""
    candidates = [
        FRONTEND_DIR,
        PROJECT_ROOT / "frontend",
        BACKEND_DIR.parent / "frontend",
        CURRENT_FILE.parent.parent.parent / "frontend",
        Path.cwd() / "frontend",
        Path.cwd().parent / "frontend",
    ]
    for c in candidates:
        if c.exists() and (c / "index.html").exists():
            return c.resolve()
    return FRONTEND_DIR.resolve()


resolved_frontend_dir = resolve_frontend_dir()
frontend_index = resolved_frontend_dir / "index.html"

# Rotas de arquivos JSON da raiz com cabeçalhos anti-cache da Fase 18
@app.get("/tracks_catalog.json", include_in_schema=False)
def serve_root_tracks_catalog_json(response: Response):
    from app.api.routes import get_raw_tracks_catalog_file
    return get_raw_tracks_catalog_file(response)


@app.get("/skysync_data.json", include_in_schema=False)
def serve_root_skysync_data_json(response: Response):
    from app.api.routes import get_raw_skysync_data_file
    return get_raw_skysync_data_file(response)


# Rota explícita da raiz (/) retornando index.html
@app.get("/", include_in_schema=False)
def serve_frontend_root():
    if frontend_index.exists():
        return FileResponse(str(frontend_index))
    raise HTTPException(status_code=404, detail="index.html do frontend não encontrado")


# Rota explícita para favicon.ico
@app.get("/favicon.ico", include_in_schema=False)
def serve_favicon():
    favicon_path = resolved_frontend_dir / "favicon.ico"
    if favicon_path.exists():
        return FileResponse(str(favicon_path), media_type="image/x-icon")
    raise HTTPException(status_code=404, detail="Favicon não encontrado")


# Montagens de diretórios estáticos
if resolved_frontend_dir.exists():
    # 1. Montagem em /static para compatibilidade com links /static/css/...
    app.mount("/static", StaticFiles(directory=str(resolved_frontend_dir)), name="static")

    # 2. Montagens dedicadas /css e /js
    css_dir = resolved_frontend_dir / "css"
    if css_dir.exists():
        app.mount("/css", StaticFiles(directory=str(css_dir)), name="css")

    js_dir = resolved_frontend_dir / "js"
    if js_dir.exists():
        app.mount("/js", StaticFiles(directory=str(js_dir)), name="js")

    # 3. Montagem abrangente na raiz com html=True garantindo resolução total de assets
    app.mount("/", StaticFiles(directory=str(resolved_frontend_dir), html=True), name="frontend")


if __name__ == "__main__":
    import uvicorn
    import os
    server_port = int(os.getenv("PORT", 3000))
    uvicorn.run("app.main:app", host="0.0.0.0", port=server_port, reload=True)
