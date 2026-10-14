import json
import os
from typing import Dict, Any, List, Optional
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.core.config import PROCESSED_DATA_FILE, TRACKS_CATALOG_FILE
from app.models.book import Book, Chapter, BookMetadata, BookSettings

router = APIRouter(prefix="/api/v1", tags=["Skysync API"])

# Cache simples em memória com verificação de modificação do arquivo
_book_cache: Optional[Book] = None
_book_cache_mtime: float = 0.0


def get_book_data() -> Book:
    """Carrega e valida o livro processado a partir do arquivo JSON gerado pelo parser."""
    global _book_cache, _book_cache_mtime

    if not PROCESSED_DATA_FILE.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(
                "Manuscrito processado (skysync_data.json) não encontrado. "
                "Execute primeiro o script: python backend/scripts/docx_parser.py"
            ),
        )

    current_mtime = os.path.getmtime(PROCESSED_DATA_FILE)
    if _book_cache is None or current_mtime > _book_cache_mtime:
        try:
            with open(PROCESSED_DATA_FILE, "r", encoding="utf-8") as f:
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
    """Retorna o catálogo completo de músicas mapeadas com links para Spotify e YouTube."""
    if not TRACKS_CATALOG_FILE.exists():
        return {}
    with open(TRACKS_CATALOG_FILE, "r", encoding="utf-8") as f:
        return json.load(f)
