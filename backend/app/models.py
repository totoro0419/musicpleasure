from pydantic import BaseModel, Field
from typing import Literal

Kind = Literal['unknown','audio','mv','live','cover','remix','local']
class Source(BaseModel):
    id: str
    provider: Literal['youtube','local'] = 'youtube'
    videoId: str | None = None
    url: str = ''
    kind: Kind = 'unknown'
    evidence: str = '未確認'
    official: bool = False
class Track(BaseModel):
    id: str
    title: str
    artist: str = '未確認'
    albumId: str | None = None
    artistId: str | None = None
    duration: float = 0
    thumbnail: str = ''
    sources: list[Source] = Field(default_factory=list)
class DownloadRequest(BaseModel):
    videoId: str = Field(pattern=r'^[A-Za-z0-9_-]{11}$')
class AssistantRequest(BaseModel):
    prompt: str = Field(min_length=1,max_length=4000)
    tracks: list[Track] = Field(default_factory=list,max_length=2000)
class Artist(BaseModel):
    id: str
    name: str
class Album(Artist):
    artistId: str | None = None
class AudioAsset(BaseModel):
    id: str
    sourceId: str
    bytes: int
    mime: str = 'audio/mpeg'
class PlaylistEntry(BaseModel):
    id: str
    trackId: str
class Playlist(BaseModel):
    id: str
    name: str
    entries: list[PlaylistEntry] = Field(default_factory=list)
class QueueEntry(PlaylistEntry):
    pass
class ImportJob(BaseModel):
    id: str
    state: Literal['parsed','resolving','preview','applied','failed']
class PlaybackHistory(BaseModel):
    trackId: str
    playedAt: str
class Favorite(BaseModel):
    trackId: str
class Settings(BaseModel):
    language: str = 'ja'
    volume: float = Field(default=0.8,ge=0,le=1)
