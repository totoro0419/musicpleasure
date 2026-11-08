export type Kind =
  | "unknown"
  | "audio"
  | "mv"
  | "live"
  | "cover"
  | "remix"
  | "local";
export interface Source {
  id: string;
  provider: "youtube" | "local";
  videoId?: string;
  url: string;
  kind: Kind;
  evidence: string;
  official: boolean;
}
export interface Track {
  id: string;
  title: string;
  artist: string;
  artistId?: string;
  albumId?: string;
  duration: number;
  thumbnail: string;
  sources: Source[];
  addedAt?: number;
  playCount?: number;
}
export interface Artist {
  id: string;
  name: string;
}
export interface Album extends Artist {
  artistId?: string;
}
export interface AudioAsset {
  id: string;
  sourceId: string;
  blob: Blob;
  bytes: number;
  createdAt: number;
}
export interface PlaylistEntry {
  id: string;
  trackId: string;
}
export interface Playlist {
  id: string;
  name: string;
  entries: PlaylistEntry[];
  createdAt: number;
}
export interface QueueEntry {
  id: string;
  trackId: string;
}
export interface PlaybackHistory {
  trackId: string;
  playedAt: number;
}
export interface Favorite {
  trackId: string;
}
export interface Settings {
  apiUrl: string;
  token: string;
  volume: number;
  repeat: "none" | "all" | "one";
  shuffle: boolean;
  language: "ja" | "en";
}
export interface LibraryData {
  tracks: Record<string, Track>;
  artists: Record<string, Artist>;
  albums: Record<string, Album>;
  playlists: Playlist[];
  favorites: string[];
}
export interface Snapshot extends LibraryData {
  schema: 1;
  queue: QueueEntry[];
  currentId: string | null;
  position: number;
  history: PlaybackHistory[];
  settings: Settings;
}
export interface DownloadJob {
  id: string;
  videoId: string;
  state:
    | "queued"
    | "downloading"
    | "converting"
    | "ready"
    | "failed"
    | "cancelled";
  progress: number;
  attempt: number;
  error?: string;
  bytes: number;
}
export interface ImportRow {
  id: string;
  raw: string;
  title: string;
  artist: string;
  url?: string;
  warning?: string;
  candidates?: Track[];
  selectedId?: string;
  skip?: boolean;
  error?: string;
}
export interface ImportJob {
  id: string;
  state: "parsed" | "resolving" | "preview" | "applied" | "failed";
  rows: ImportRow[];
}
export interface Proposal {
  summary: string;
  operations: {
    type:
      | "search"
      | "exclude_live"
      | "deduplicate"
      | "sort_artist"
      | "create_playlist";
    name?: string;
    queries?: string[];
    trackIds?: string[];
  }[];
}
export const kindLabels: Record<Kind, string> = {
  unknown: "未確認",
  audio: "音源",
  mv: "MV",
  live: "ライブ",
  cover: "カバー",
  remix: "リミックス",
  local: "MP3",
};
export const uid = () =>
  crypto.randomUUID?.() ||
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
export const normalized = (v: string) =>
  v
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, "");
