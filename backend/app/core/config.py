import os
from pathlib import Path
from dotenv import load_dotenv

# Diretórios base
BACKEND_DIR = Path(__file__).resolve().parent.parent.parent
PROJECT_ROOT = BACKEND_DIR.parent
DATA_DIR = BACKEND_DIR / "data"
PROCESSED_DATA_FILE = DATA_DIR / "processed" / "skysync_data.json"
TRACKS_CATALOG_FILE = BACKEND_DIR / "scripts" / "tracks_catalog.json"
FRONTEND_DIR = PROJECT_ROOT / "frontend"

# Carregamento do arquivo de variáveis de ambiente (.env)
env_candidates = [
    BACKEND_DIR / ".env",
    PROJECT_ROOT / ".env",
]
for env_file in env_candidates:
    if env_file.exists():
        load_dotenv(env_file)
        break
else:
    load_dotenv()

# Credenciais do Spotify (Authorization Code Flow)
SPOTIFY_CLIENT_ID = os.getenv("SPOTIFY_CLIENT_ID", "")
SPOTIFY_CLIENT_SECRET = os.getenv("SPOTIFY_CLIENT_SECRET", "")
SPOTIFY_REDIRECT_URI = os.getenv(
    "SPOTIFY_REDIRECT_URI", "http://127.0.0.1:8000/api/v1/auth/callback"
)

# Escopos exigidos para o Web Playback SDK e controle de playback
SPOTIFY_SCOPES = "streaming user-read-email user-read-private user-modify-playback-state"

# URLs oficiais de Autenticação e Token do Spotify
SPOTIFY_AUTH_URL = "https://accounts.spotify.com/authorize"
SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token"

# Configurações do servidor
APP_TITLE = "Skysync API"
APP_DESCRIPTION = "API de leitura imersiva e sincronização de trilhas sonoras para Skyhaven (100% Exclusivo Spotify)."
APP_VERSION = "1.1.0-spotify"
