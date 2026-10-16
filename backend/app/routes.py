"""
Skysync - Rotas Principais (backend/app/routes.py)
Fase 18: Cache-Busting e Gestão Rigorosa de Estado
"""
from app.api.routes import (
    router,
    apply_no_cache_headers,
    NO_CACHE_HEADERS,
    get_book_data,
    get_tracks_catalog,
    get_raw_tracks_catalog_file,
    get_raw_skysync_data_file,
    get_full_book,
    get_book_overview,
    get_chapter,
    spotify_callback,
    spotify_login,
    spotify_auth_status,
)

__all__ = [
    "router",
    "apply_no_cache_headers",
    "NO_CACHE_HEADERS",
    "get_book_data",
    "get_tracks_catalog",
    "get_raw_tracks_catalog_file",
    "get_raw_skysync_data_file",
    "get_full_book",
    "get_book_overview",
    "get_chapter",
    "spotify_callback",
    "spotify_login",
    "spotify_auth_status",
]

