import Dexie, { type Table } from "dexie";
import type { AudioAsset, Snapshot } from "./types";
class MusicDB extends Dexie {
  snapshots!: Table<{ id: string; value: Snapshot }, string>;
  assets!: Table<AudioAsset, string>;
  credentials!: Table<{id: string; credential: string}, string>;
  constructor() {
    super("musicpleasure");
    this.version(1).stores({
      snapshots: "id",
      assets: "id,sourceId,createdAt",
    });
    this.version(2).stores({ credentials: "id" });
  }
}
export const db = new MusicDB();
export function validateSnapshot(input: unknown): Snapshot {
  if (!input || typeof input !== "object")
    throw new Error("バックアップの形式が不正です");
  const s = input as Snapshot;
  if (
    s.schema !== 1 ||
    !s.tracks ||
    typeof s.tracks !== "object" ||
    Array.isArray(s.tracks) ||
    !Array.isArray(s.playlists) ||
    !Array.isArray(s.queue) ||
    !Array.isArray(s.favorites) ||
    !Array.isArray(s.history) ||
    !s.settings
  )
    throw new Error("未対応のバックアップ形式です");
  if (Object.keys(s.tracks).length > 100000 || s.playlists.length > 5000)
    throw new Error("バックアップが大きすぎます");
  const own = (id: unknown) =>
    typeof id === "string" && Object.hasOwn(s.tracks, id);
  for (const [id, t] of Object.entries(s.tracks))
    if (
      !t ||
      id !== t.id ||
      typeof t.title !== "string" ||
      typeof t.artist !== "string" ||
      !Array.isArray(t.sources) ||
      typeof t.duration !== "number" ||
      !Number.isFinite(t.duration) ||
      typeof t.thumbnail !== "string" ||
      t.sources.some(
        (a) =>
          !a ||
          typeof a.id !== "string" ||
          !["youtube", "local"].includes(a.provider) ||
          ![
            "unknown",
            "audio",
            "mv",
            "live",
            "cover",
            "remix",
            "local",
          ].includes(a.kind) ||
          typeof a.url !== "string" ||
          (a.provider === "youtube" && !/^[\w-]{11}$/.test(a.videoId || "")),
      )
    )
      throw new Error("楽曲データが不正です");
  const entry = (e: { id: string; trackId: string }) =>
    e && typeof e.id === "string" && own(e.trackId);
  const unique = (ids: string[]) => new Set(ids).size === ids.length;
  for (const p of s.playlists)
    if (
      !p ||
      typeof p.id !== "string" ||
      typeof p.name !== "string" ||
      !Array.isArray(p.entries) ||
      !p.entries.every(entry) ||
      !unique(p.entries.map((e) => e.id))
    )
      throw new Error("プレイリストの参照が不正です");
  if (
    !unique(s.playlists.map((p) => p.id)) ||
    !s.queue.every(entry) ||
    !unique(s.queue.map((e) => e.id)) ||
    !s.favorites.every(own) ||
    !s.history.every(
      (h) => h && own(h.trackId) && Number.isFinite(h.playedAt),
    ) ||
    !Number.isFinite(s.position) ||
    s.position < 0 ||
    (s.currentId !== null && !s.queue.some((q) => q.id === s.currentId))
  )
    throw new Error("再生データの参照が不正です");
  if (
    !Number.isFinite(s.settings.volume) ||
    s.settings.volume < 0 ||
    s.settings.volume > 1 ||
    !["none", "all", "one"].includes(s.settings.repeat) ||
    typeof s.settings.shuffle !== "boolean"
  )
    throw new Error("再生設定が不正です");
  // Never restore connection secrets from someone else's backup.
  return {
    ...s,
    artists: s.artists || {},
    albums: s.albums || {},
    settings: { ...s.settings, apiUrl: "", token: "", language: "ja" },
  };
}
let chain = Promise.resolve();
export function saveSnapshot(value: Snapshot) {
  chain = chain
    .catch(() => {})
    .then(async () => {
      await db.transaction("rw", db.snapshots, async () => {
        const old = await db.snapshots.get("current");
        if (old) await db.snapshots.put({ ...old, id: "recovery" });
        await db.snapshots.put({ id: "current", value });
      });
    });
  return chain;
}
