import type { Data, Track, Playlist } from "../types";
export const emptyData = (): Data => ({
  version: 2,
  tracks: {},
  playlists: [],
  favorites: [],
  channels: [],
  history: [],
  listening: {},
  disliked: [],
  queue: [],
  current: -1,
  position: 0,
  shuffle: false,
  repeat: "off",
  radio: false,
  settings: {
    quality: "balanced",
    engine: "piped",
    instance: "",
    radioMode: "balance",
    discovery: 55,
    weights: { related: 5, favorite: 4, fresh: 3, recent: 8 },
    theme: "dark",
  },
  searches: [],
  importJob: [],
});
export const unique = (ids: string[]) => [...new Set(ids)];
export const validId = (id: string) => /^[A-Za-z0-9_-]{11}$/.test(id);
export function videoId(input: string): string | null {
  if (validId(input.trim())) return input.trim();
  try {
    const u = new URL(input, "https://www.youtube.com");
    if (
      !/(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/.test(u.hostname)
    )
      return null;
    const id =
      u.hostname === "youtu.be"
        ? u.pathname.split("/")[1]
        : u.searchParams.get("v") ||
          u.pathname.match(/\/(shorts|embed|live)\/([^/?]+)/)?.[2];
    return id && validId(id) ? id : null;
  } catch {
    return null;
  }
}
export function playlistId(input: string) {
  try {
    const u = new URL(input);
    if (!/(^|\.)(youtube\.com|youtu\.be)$/.test(u.hostname)) return null;
    const id = u.searchParams.get("list");
    return id && /^[\w-]+$/.test(id) ? id : null;
  } catch {
    return null;
  }
}
export const placeholder = (id: string): Track => ({
  id,
  title: `YouTube · ${id}`,
  uploader: "動画URLから追加",
  thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
  duration: 0,
});
export const newId = () =>
  typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : Array.from(crypto.getRandomValues(new Uint8Array(16)), (n) =>
        n.toString(16).padStart(2, "0"),
      ).join("");
export const newPlaylist = (name: string, tracks: string[] = []): Playlist => ({
  id: newId(),
  name: name.trim() || "新しいプレイリスト",
  description: "",
  cover: "",
  tracks: unique(tracks),
  favorite: false,
  created: Date.now(),
});
export function fromItem(item: import("../types").PipedItem): Track | null {
  const id = videoId(item.url || "");
  return id
    ? {
        id,
        title: item.title || item.name || id,
        uploader: item.uploaderName || item.uploader || "",
        thumbnail:
          safeImage(item.thumbnail || item.thumbnailUrl || "") ||
          placeholder(id).thumbnail,
        duration: Math.max(0, Number(item.duration) || 0),
        uploaderUrl: item.uploaderUrl,
        uploaded: item.uploadedDate,
        verified: item.uploaderVerified,
      }
    : null;
}
export function safeImage(url: string) {
  try {
    return new URL(url).protocol === "https:" ? url : "";
  } catch {
    return "";
  }
}
export function shuffleTail(
  queue: string[],
  current: number,
  rng = Math.random,
) {
  const head = queue.slice(0, current + 1),
    tail = queue.slice(current + 1);
  for (let i = tail.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [tail[i], tail[j]] = [tail[j], tail[i]];
  }
  return [...head, ...tail];
}
export function nextIndex(
  d: Pick<Data, "current" | "queue" | "repeat">,
  ended = false,
) {
  if (!d.queue.length) return -1;
  if (ended && d.repeat === "one") return d.current;
  if (d.current + 1 < d.queue.length) return d.current + 1;
  return d.repeat === "all" ? 0 : -1;
}
export function move<T>(a: T[], from: number, to: number) {
  const r = [...a];
  if (from < 0 || from >= a.length || to < 0 || to >= a.length) return r;
  const [v] = r.splice(from, 1);
  r.splice(to, 0, v);
  return r;
}
export function validateBackup(raw: unknown): Data {
  if (!raw || typeof raw !== "object")
    throw Error("バックアップの形式が正しくありません");
  const d = raw as Data;
  if (d.version !== 2 && Number(d.version) !== 1)
    throw Error("未対応のバックアップバージョンです");
  if (!d.tracks || typeof d.tracks !== "object" || !Array.isArray(d.playlists))
    throw Error("曲・プレイリストデータが破損しています");
  const base = emptyData();
  const tracks: Record<string, Track> = {};
  for (const [id, t] of Object.entries(d.tracks)) {
    if (
      !validId(id) ||
      !t ||
      typeof t.title !== "string" ||
      typeof t.uploader !== "string" ||
      !Number.isFinite(t.duration) ||
      t.duration < 0
    )
      throw Error("曲データが破損しています");
    tracks[id] = {
      id,
      title: t.title,
      uploader: t.uploader,
      thumbnail: safeImage(t.thumbnail),
      duration: t.duration,
      uploaderUrl:
        typeof t.uploaderUrl === "string" ? t.uploaderUrl : undefined,
    };
  }
  const ids = (x: unknown) =>
    unique(
      Array.isArray(x)
        ? x.filter((id): id is string => typeof id === "string" && !!tracks[id])
        : [],
    );
  const seen = new Set<string>();
  const playlists = d.playlists.map((p) => {
    if (
      !p ||
      typeof p.id !== "string" ||
      seen.has(p.id) ||
      typeof p.name !== "string" ||
      !Array.isArray(p.tracks)
    )
      throw Error("プレイリストデータが破損しています");
    seen.add(p.id);
    return {
      ...newPlaylist(p.name),
      id: p.id,
      tracks: ids(p.tracks),
      description: typeof p.description === "string" ? p.description : "",
      cover: safeImage(p.cover),
      favorite: !!p.favorite,
    };
  });
  const settings = {
    ...base.settings,
    ...d.settings,
    weights: { ...base.settings.weights, ...d.settings?.weights },
  };
  settings.engine = "piped";
  if (
    settings.engine !== "piped" ||
    !["balanced", "high", "data"].includes(settings.quality) ||
    ![
      "favorites",
      "balance",
      "discovery",
      "covers",
      "channel",
      "versions",
    ].includes(settings.radioMode) ||
    !["dark", "light"].includes(settings.theme) ||
    !Number.isFinite(settings.discovery) ||
    settings.discovery < 0 ||
    settings.discovery > 100 ||
    Object.values(settings.weights).some(
      (x) => !Number.isFinite(x) || x < 0 || x > 20,
    )
  )
    throw Error("設定データが破損しています");
  settings.instance =
    typeof settings.instance === "string" &&
    settings.instance.startsWith("https://")
      ? settings.instance
      : "";
  const listening: Data["listening"] = {};
  for (const [id, s] of Object.entries(d.listening || {})) {
    if (
      !tracks[id] ||
      !s ||
      ["plays", "seconds", "skips", "last", "failed"].some(
        (k) =>
          !Number.isFinite(s[k as keyof typeof s]) ||
          s[k as keyof typeof s] < 0,
      )
    )
      continue;
    listening[id] = s;
  }
  const queue = Array.isArray(d.queue)
    ? d.queue.filter((id) => typeof id === "string" && !!tracks[id])
    : [];
  return {
    ...base,
    tracks,
    playlists,
    favorites: ids(d.favorites),
    history: ids(d.history),
    disliked: ids(d.disliked),
    channels: Array.isArray(d.channels)
      ? d.channels.filter((x) => typeof x === "string").slice(0, 1000)
      : [],
    listening,
    queue,
    current: queue.length
      ? Math.min(Math.max(0, Number(d.current) || 0), queue.length - 1)
      : -1,
    position: Math.max(0, Number(d.position) || 0),
    repeat: ["off", "all", "one"].includes(d.repeat) ? d.repeat : "off",
    shuffle: !!d.shuffle,
    radio: !!d.radio,
    settings,
    searches: Array.isArray(d.searches)
      ? d.searches.filter((x) => typeof x === "string").slice(0, 30)
      : [],
  };
}
export const time = (s: number) =>
  !Number.isFinite(s)
    ? "0:00"
    : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
