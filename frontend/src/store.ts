import { create } from "zustand";
import { db, saveSnapshot, validateSnapshot } from "./db";
import { uid, normalized } from "./types";
import type { Track, Playlist, Snapshot, LibraryData, Settings } from "./types";
const empty: Snapshot = {
  schema: 1,
  tracks: {},
  artists: {},
  albums: {},
  playlists: [],
  favorites: [],
  queue: [],
  currentId: null,
  position: 0,
  history: [],
  settings: {
    apiUrl: import.meta.env.VITE_API_URL || "",
    token: "",
    volume: 0.8,
    repeat: "none",
    shuffle: false,
    language: "ja",
  },
};
interface State extends Snapshot {
  loaded: boolean;
  saveError: string;
  past: LibraryData[];
  future: LibraryData[];
  edit: (fn: (d: Snapshot) => void) => void;
  addTracks: (ts: Track[]) => void;
  createPlaylist: (name: string, ts?: Track[]) => string;
  updatePlaylist: (id: string, fn: (p: Playlist) => void) => void;
  deletePlaylist: (id: string) => void;
  favorite: (id: string) => void;
  undo: () => void;
  redo: () => void;
  enqueue: (ts: Track[], next?: boolean) => void;
  play: (ts: Track[], index?: number) => void;
  setCurrent: (id: string | null) => void;
  recordPlay: (id: string) => void;
  settingsUpdate: (s: Partial<Settings>) => void;
  restore: (s: unknown) => void;
}
const library = (s: Snapshot): LibraryData => ({
  tracks: s.tracks,
  artists: s.artists,
  albums: s.albums,
  playlists: s.playlists,
  favorites: s.favorites,
});
export function snapshot(s: Snapshot): Snapshot {
  return {
    schema: 1,
    ...library(s),
    queue: s.queue,
    currentId: s.currentId,
    position: s.position,
    history: s.history,
    settings: s.settings,
  };
}
export function putTracks(d: Snapshot, ts: Track[]) {
  for (const t of ts) {
    d.tracks[t.id] = {
      addedAt: Date.now(),
      playCount: 0,
      ...d.tracks[t.id],
      ...t,
    };
    const id = t.artistId || `artist:${normalized(t.artist)}`;
    d.artists[id] = { id, name: t.artist };
    d.tracks[t.id].artistId = id;
  }
}
export const useStore = create<State>((set, get) => ({
  ...empty,
  loaded: false,
  saveError: "",
  past: [],
  future: [],
  edit(fn) {
    const s = get(),
      d = structuredClone(snapshot(s));
    fn(d);
    set({
      ...d,
      past: [...s.past.slice(-29), structuredClone(library(s))],
      future: [],
    });
  },
  addTracks(ts) {
    get().edit((d) => putTracks(d, ts));
  },
  createPlaylist(name, ts = []) {
    const id = uid();
    get().edit((d) => {
      putTracks(d, ts);
      d.playlists.push({
        id,
        name: name.trim() || "新しいプレイリスト",
        entries: ts.map((t) => ({ id: uid(), trackId: t.id })),
        createdAt: Date.now(),
      });
    });
    return id;
  },
  updatePlaylist(id, fn) {
    get().edit((d) => {
      const p = d.playlists.find((p) => p.id === id);
      if (p) fn(p);
    });
  },
  deletePlaylist(id) {
    get().edit((d) => {
      d.playlists = d.playlists.filter((p) => p.id !== id);
    });
  },
  favorite(id) {
    get().edit((d) => {
      d.favorites = d.favorites.includes(id)
        ? d.favorites.filter((v) => v !== id)
        : [...d.favorites, id];
    });
  },
  undo() {
    const s = get(),
      previous = s.past.at(-1);
    if (previous) {
      const retained = { ...previous.tracks };
      for (const q of s.queue)
        if (!retained[q.trackId]) retained[q.trackId] = s.tracks[q.trackId];
      for (const h of s.history)
        if (!retained[h.trackId]) retained[h.trackId] = s.tracks[h.trackId];
      set({
        ...previous,
        tracks: retained,
        past: s.past.slice(0, -1),
        future: [structuredClone(library(s)), ...s.future],
      });
    }
  },
  redo() {
    const s = get(),
      next = s.future[0];
    if (next) {
      const tracks = { ...next.tracks };
      for (const q of s.queue)
        if (!tracks[q.trackId]) tracks[q.trackId] = s.tracks[q.trackId];
      for (const h of s.history)
        if (!tracks[h.trackId]) tracks[h.trackId] = s.tracks[h.trackId];
      set({
        ...next,
        tracks,
        past: [...s.past, structuredClone(library(s))],
        future: s.future.slice(1),
      });
    }
  },
  enqueue(ts, next = false) {
    const s = get(),
      d = structuredClone(snapshot(s));
    putTracks(d, ts);
    const es = ts.map((t) => ({ id: uid(), trackId: t.id }));
    const i = d.queue.findIndex((q) => q.id === d.currentId);
    d.queue.splice(next ? i + 1 : d.queue.length, 0, ...es);
    set(d);
  },
  play(ts, index = 0) {
    if (!ts.length) return;
    const d = structuredClone(snapshot(get()));
    putTracks(d, ts);
    d.queue = ts.map((t) => ({ id: uid(), trackId: t.id }));
    d.currentId = d.queue[index]?.id || d.queue[0].id;
    d.position = 0;
    set(d);
  },
  setCurrent(id) {
    set({ currentId: id, position: 0 });
  },
  recordPlay(id) {
    const s = get();
    if (!s.tracks[id]) return;
    set({
      history: [{ trackId: id, playedAt: Date.now() }, ...s.history].slice(
        0,
        1000,
      ),
      tracks: {
        ...s.tracks,
        [id]: { ...s.tracks[id], playCount: (s.tracks[id].playCount || 0) + 1 },
      },
    });
  },
  settingsUpdate(v) {
    set({ settings: { ...get().settings, ...v } });
  },
  restore(raw) {
    const v = validateSnapshot(raw);
    get().edit((d) => {
      Object.assign(d, v, {
        settings: {
          ...v.settings,
          apiUrl: get().settings.apiUrl,
          token: get().settings.token,
        },
      });
    });
  },
}));
let saveTimer: ReturnType<typeof setTimeout>;
useStore.subscribe((s) => {
  if (!s.loaded) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveSnapshot(snapshot(useStore.getState())).catch(
      () =>
        !useStore.getState().saveError &&
        useStore.setState({
          saveError:
            "端末への保存に失敗しました。空き容量を確認してバックアップを書き出してください",
        }),
    );
  }, 400);
});
export async function loadStore() {
  try {
    const v = await db.snapshots.get("current");
    if (v) {
      const validated = validateSnapshot(v.value);
      useStore.setState({
        ...validated,
        settings: {
          ...validated.settings,
          apiUrl: v.value.settings.apiUrl || import.meta.env.VITE_API_URL || "",
          token: v.value.settings.token || "",
        },
      });
    }
  } catch {
    try {
      const previous = await db.snapshots.get("recovery");
      if (previous) {
        const v = validateSnapshot(previous.value);
        useStore.setState({
          ...v,
          saveError: "保存データを前回の状態から復旧しました",
        });
      } else
        useStore.setState({
          saveError:
            "保存データを読み込めませんでした。バックアップから復元してください",
        });
    } catch {
      useStore.setState({ saveError: "端末内データベースを開けませんでした" });
    }
  } finally {
    useStore.setState({ loaded: true });
  }
}
export function reorder<T>(items: T[], from: number, to: number): T[] {
  if (from < 0 || to < 0 || from >= items.length || to >= items.length)
    return items;
  const out = [...items];
  out.splice(to, 0, out.splice(from, 1)[0]);
  return out;
}
export function deduplicateEntries(p: Playlist, tracks: Record<string, Track>) {
  const seen = new Set<string>();
  p.entries = p.entries.filter((e) => {
    const t = tracks[e.trackId];
    const k = normalized(t.artist + "|" + t.title);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
