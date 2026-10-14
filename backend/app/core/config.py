from pathlib import Path

# Diretórios base
BACKEND_DIR = Path(__file__).resolve().parent.parent.parent
PROJECT_ROOT = BACKEND_DIR.parent
DATA_DIR = BACKEND_DIR / "data"
PROCESSED_DATA_FILE = DATA_DIR / "processed" / "skysync_data.json"
TRACKS_CATALOG_FILE = BACKEND_DIR / "scripts" / "tracks_catalog.json"
FRONTEND_DIR = PROJECT_ROOT / "frontend"

# Configurações do servidor
APP_TITLE = "Skysync API"
APP_DESCRIPTION = "API de leitura imersiva e sincronização de trilhas sonoras para Skyhaven."
APP_VERSION = "1.0.0-mvp"
