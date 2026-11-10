export interface Track {
  id: string;
  title: string;
  uploader: string;
  thumbnail: string;
  duration: number;
  uploaderUrl?: string;
  uploaded?: string;
  verified?: boolean;
  reason?: string;
}
export interface Playlist {
  id: string;
  name: string;
  description: string;
  cover: string;
  tracks: string[];
  favorite: boolean;
  created: number;
}
export interface Listening {
  plays: number;
  seconds: number;
  skips: number;
  last: number;
  failed: number;
}
export type RadioMode =
  "favorites" | "balance" | "discovery" | "covers" | "channel" | "versions";
export interface Settings {
  quality: "balanced" | "high" | "data";
  engine: "invidious";
  instance: string;
  radioMode: RadioMode;
  discovery: number;
  weights: { related: number; favorite: number; fresh: number; recent: number };
  theme: "dark" | "light";
}
export interface ImportItem {
  query: string;
  status: "pending" | "matched" | "review" | "failed";
  candidates: Track[];
  selected?: string;
  error?: string;
}
export interface Data {
  version: 2;
  tracks: Record<string, Track>;
  playlists: Playlist[];
  favorites: string[];
  channels: string[];
  history: string[];
  listening: Record<string, Listening>;
  disliked: string[];
  queue: string[];
  current: number;
  position: number;
  shuffle: boolean;
  repeat: "off" | "all" | "one";
  radio: boolean;
  settings: Settings;
  searches: string[];
  importJob: ImportItem[];
}
export interface InvidiousItem {
  url?: string;
  type?: string;
  title?: string;
  name?: string;
  uploaderName?: string;
  uploader?: string;
  uploaderUrl?: string;
  thumbnail?: string;
  thumbnailUrl?: string;
  duration?: number;
  uploadedDate?: string;
  uploaderVerified?: boolean;
}
export interface AudioStream {
  url: string;
  /** Invidious format ID; permits retrying via the instance media proxy. */
  itag?: string;
  mimeType: string;
  codec?: string;
  bitrate: number;
  quality?: string;
  format?: string;
}
export interface StreamInfo {
  title: string;
  uploader: string;
  uploaderUrl: string;
  thumbnailUrl: string;
  duration: number;
  audioStreams: AudioStream[];
  videoStreams?: (AudioStream & { videoOnly: boolean })[];
  relatedStreams: InvidiousItem[];
}
export interface SearchPage {
  items: InvidiousItem[];
  nextpage?: string | null;
  corrected?: boolean;
  suggestion?: string;
}
export interface InstanceHealth {
  url: string;
  success: number;
  failure: number;
  latency: number;
  cooldown: number;
  lastError: string;
  audioSuccess: number;
  lastChecked: number;
  audioFailure?: number;
  audioPrepared?: number;
  lastAudioSuccess?: number;
  lastAudioError?: string;
  audioCooldown?: number;
}
