import base64
import json
import os
import urllib.parse
from typing import Dict, Any, List, Optional
import httpx
from fastapi import APIRouter, HTTPException, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from app.core import config
from app.models.book import Book, Chapter, BookMetadata, BookSettings

router = APIRouter(prefix="/api/v1", tags=["Skysync API"])

# Cache simples em memória com verificação de modificação do arquivo
_book_cache: Optional[Book] = None
_book_cache_mtime: float = 0.0


def get_book_data() -> Book:
    """Carrega e valida o livro processado a partir do arquivo JSON gerado pelo parser."""
    global _book_cache, _book_cache_mtime

    if not config.PROCESSED_DATA_FILE.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(
                "Manuscrito processado (skysync_data.json) não encontrado. "
                "Execute primeiro o script: python backend/scripts/docx_parser.py"
            ),
        )

    current_mtime = os.path.getmtime(config.PROCESSED_DATA_FILE)
    if _book_cache is None or current_mtime > _book_cache_mtime:
        try:
            with open(config.PROCESSED_DATA_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            _book_cache = Book(**data)
            _book_cache_mtime = current_mtime
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Erro ao processar dados do livro: {str(e)}",
            )

    return _book_cache


class ChapterSummary(BaseModel):
    id: str
    number: int
    title: str
    estimated_read_time_minutes: int
    total_blocks: int
    total_audio_triggers: int
    is_preface: bool = False


class BookOverviewResponse(BaseModel):
    metadata: BookMetadata
    settings: BookSettings
    chapters: List[ChapterSummary]


# =====================================================================
# Rotas de Autenticação Segura via Spotify (Authorization Code Flow)
# =====================================================================

@router.get("/auth/login", summary="Iniciar Autenticação com Spotify")
def spotify_login():
    """
    Redireciona o usuário para a página de autorização oficial do Spotify
    solicitando os escopos necessários para streaming e controle do player.
    """
    client_id = config.SPOTIFY_CLIENT_ID
    if not client_id or client_id == "your_spotify_client_id_here":
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=(
                "SPOTIFY_CLIENT_ID não configurado no .env. "
                "Adicione suas credenciais do Spotify Developer Dashboard no arquivo .env."
            ),
        )

    params = {
        "client_id": client_id,
        "response_type": "code",
        "redirect_uri": config.SPOTIFY_REDIRECT_URI,
        "scope": config.SPOTIFY_SCOPES,
        "show_dialog": "true",
    }
    auth_redirect_url = f"{config.SPOTIFY_AUTH_URL}?{urllib.parse.urlencode(params)}"
    return RedirectResponse(
        url=auth_redirect_url, status_code=status.HTTP_307_TEMPORARY_REDIRECT
    )


@router.get("/auth/callback", summary="Callback de Autenticação do Spotify")
async def spotify_callback(code: Optional[str] = None, error: Optional[str] = None):
    """
    Recebe o authorization code enviado pelo Spotify após aprovação do usuário,
    troca pelo Access Token via POST na API do Spotify e redireciona de volta
    para o frontend em '/?token=XYZ'.
    """
    if error:
        return RedirectResponse(url=f"/?auth_error={urllib.parse.quote(error)}")

    if not code:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Código de autorização não recebido no callback do Spotify.",
        )

    auth_str = f"{config.SPOTIFY_CLIENT_ID}:{config.SPOTIFY_CLIENT_SECRET}"
    b64_auth = base64.b64encode(auth_str.encode("utf-8")).decode("utf-8")

    headers = {
        "Authorization": f"Basic {b64_auth}",
        "Content-Type": "application/x-www-form-urlencoded",
    }
    data = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": config.SPOTIFY_REDIRECT_URI,
    }

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(config.SPOTIFY_TOKEN_URL, data=data, headers=headers)

        if resp.status_code != 200:
            error_detail = resp.text
            return RedirectResponse(
                url=f"/?auth_error={urllib.parse.quote('Falha na troca de token com Spotify: ' + error_detail)}"
            )

        token_data = resp.json()
        access_token = token_data.get("access_token")
        if not access_token:
            return RedirectResponse(url="/?auth_error=Token_invalido_recebido_do_Spotify")

        return RedirectResponse(
            url=f"/?token={access_token}", status_code=status.HTTP_307_TEMPORARY_REDIRECT
        )

    except Exception as e:
        return RedirectResponse(
            url=f"/?auth_error={urllib.parse.quote(f'Erro de conexão ao trocar token: {str(e)}')}"
        )


@router.get("/auth/status", summary="Verificar Configuração de Autenticação")
def spotify_auth_status():
    """Verifica se o backend está configurado com credenciais do Spotify."""
    client_id = config.SPOTIFY_CLIENT_ID
    client_secret = config.SPOTIFY_CLIENT_SECRET
    is_configured = bool(
        client_id
        and client_secret
        and client_id != "your_spotify_client_id_here"
    )
    return {
        "is_configured": is_configured,
        "redirect_uri": config.SPOTIFY_REDIRECT_URI,
        "scopes": config.SPOTIFY_SCOPES,
    }


# =====================================================================
# Rotas de Conteúdo do Livro e Catálogo de Faixas
# =====================================================================

@router.get("/book", response_model=Book, summary="Obter Livro Completo")
def get_full_book():
    """Retorna a estrutura completa do livro, incluindo todos os capítulos, parágrafos e gatilhos de áudio."""
    return get_book_data()


@router.get(
    "/book/overview",
    response_model=BookOverviewResponse,
    summary="Sumário do Livro (TOC)",
)
def get_book_overview():
    """Retorna os metadados do livro e a lista resumida de capítulos para exibição do índice/menu."""
    book = get_book_data()
    summaries = [
        ChapterSummary(
            id=ch.id,
            number=ch.number,
            title=ch.title,
            estimated_read_time_minutes=ch.estimated_read_time_minutes,
            total_blocks=len(ch.content_blocks),
            total_audio_triggers=sum(
                1 for b in ch.content_blocks if b.audio_trigger is not None
            ),
            is_preface=getattr(ch, "is_preface", False),
        )
        for ch in book.chapters
    ]
    return BookOverviewResponse(
        metadata=book.book_metadata,
        settings=book.settings,
        chapters=summaries,
    )


@router.get("/chapters/{chapter_id}", response_model=Chapter, summary="Obter Capítulo Específico")
def get_chapter(chapter_id: str):
    """Retorna o capítulo solicitado pelo identificador (ex: 'cap-01') com todos os seus blocos e gatilhos."""
    book = get_book_data()
    for ch in book.chapters:
        if ch.id.lower() == chapter_id.lower() or str(ch.number) == chapter_id:
            return ch
    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail=f"Capítulo '{chapter_id}' não encontrado.",
    )


@router.get("/tracks/catalog", summary="Obter Catálogo de Músicas")
def get_tracks_catalog() -> Dict[str, Any]:
    """Retorna o catálogo completo de músicas mapeadas com links e IDs para Spotify."""
    if not config.TRACKS_CATALOG_FILE.exists():
        return {}
    with open(config.TRACKS_CATALOG_FILE, "r", encoding="utf-8") as f:
        return json.load(f)
