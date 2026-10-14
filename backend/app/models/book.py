from typing import List, Optional
from pydantic import BaseModel, Field


class SpotifyProvider(BaseModel):
    uri: str
    id: str
    preview_url: Optional[str] = None


class YouTubeProvider(BaseModel):
    video_id: str
    start_seconds: int = 0


class Providers(BaseModel):
    spotify: Optional[SpotifyProvider] = None
    youtube: Optional[YouTubeProvider] = None


class PlaybackOptions(BaseModel):
    fade_in_ms: int = 2000
    volume: float = 0.85
    loop: bool = True
    interrupt_previous: bool = True


class Track(BaseModel):
    id: str
    title: str
    artist: str
    album: Optional[str] = None
    duration_seconds: Optional[int] = None
    role: Optional[str] = "trigger"
    providers: Providers
    default_playback_options: Optional[PlaybackOptions] = None


class AudioTrigger(BaseModel):
    trigger_id: str
    action: str = "PLAY_TRACK"
    delay_ms: int = 1500
    track: Track
    playback_options: Optional[PlaybackOptions] = None


class ContentBlock(BaseModel):
    id: str
    type: str = "paragraph"
    order: int
    page_hint: int = 1
    text: str
    audio_trigger: Optional[AudioTrigger] = None


class Chapter(BaseModel):
    id: str
    number: int
    title: str
    estimated_read_time_minutes: int = 10
    summary: Optional[str] = None
    is_preface: bool = False
    content_blocks: List[ContentBlock] = Field(default_factory=list)


class BookMetadata(BaseModel):
    id: str = "skyhaven-vol1"
    title: str = "Skyhaven"
    subtitle: Optional[str] = "Crônicas do Éter"
    author: str = "Autor Desconhecido"
    version: str = "1.0-mvp"
    total_chapters: int = 0
    created_at: str


class BookSettings(BaseModel):
    default_trigger_delay_ms: int = 1500
    default_fade_duration_ms: int = 2000
    default_volume: float = 0.85


class Book(BaseModel):
    book_metadata: BookMetadata
    settings: BookSettings = Field(default_factory=BookSettings)
    chapters: List[Chapter] = Field(default_factory=list)
