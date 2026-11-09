import { useSyncExternalStore } from "react";
import type { Data, Track, Settings } from "../types";
import {
  emptyData,
  newPlaylist,
  unique,
  nextIndex,
  shuffleTail,
} from "./model";
import { readData, saveData } from "./storage";
import { player, type PlaybackState } from "./player";
import { piped } from "./piped";
import { recommend } from "./recommend";
let data = emptyData();
let playback = player.state;
let notice = "";
let loaded = false;
let savingBlocked = false;
let revision = 0;
let healthRevision = 0;
let snapshot = { data, playback, notice, loaded, revision, healthRevision };
const listeners = new Set<() => void>();
let radioAbort: AbortController | undefined;
let radioPending = false;
let lastPositionSave = 0;
let previous: Data[] = [];
let future: Data[] = [];
function emit() {
  snapshot = {
    data,
    playback,
    notice,
    loaded,
    revision: ++revision,
    healthRevision,
  };
  listeners.forEach((fn) => fn());
}
function persist() {
  if (savingBlocked || !loaded) return;
  void saveData(data).catch((e) => {
    notice = `保存できません。バックアップを書き出してください：${e.message}`;
    emit();
  });
}
export const store = {
  get data() {
    return data;
  },
  get playback() {
    return playback;
  },
  get canUndo() {
    return previous.length > 0;
  },
  get canRedo() {
    return future.length > 0;
  },
  async init() {
    try {
      data = await readData();
    } catch (e) {
      savingBlocked = true;
      notice = `保存データを読み込めません。元データ保護のため自動保存を停止しました。バックアップの読み込みで復元してください：${e instanceof Error ? e.message : String(e)}`;
    }
    loaded = true;
    piped.preferred = data.settings.instance;
    emit();
    void piped.init();
  },
  update(fn: (d: Data) => Data, undo = false) {
    if (undo) {
      previous.push(structuredClone(data));
      previous = previous.slice(-30);
      future = [];
    }
    data = fn(data);
    persist();
    emit();
  },
  enableSaving() {
    savingBlocked = false;
  },
  notify(message: string) {
    notice = message;
    emit();
  },
  addTracks(tracks: Track[]) {
    this.update((d) => ({
      ...d,
      tracks: {
        ...d.tracks,
        ...Object.fromEntries(tracks.map((t) => [t.id, t])),
      },
    }));
  },
  create(name: string, tracks: string[] = []) {
    const p = newPlaylist(name, tracks);
    this.update((d) => ({ ...d, playlists: [...d.playlists, p] }), true);
    return p.id;
  },
  addToPlaylist(id: string, ids: string[]) {
    this.update(
      (d) => ({
        ...d,
        playlists: d.playlists.map((p) =>
          p.id === id ? { ...p, tracks: unique([...p.tracks, ...ids]) } : p,
        ),
      }),
      true,
    );
    this.notify(`${ids.length}曲をプレイリストへ追加しました`);
  },
  favorite(id: string) {
    this.update(
      (d) => ({
        ...d,
        favorites: d.favorites.includes(id)
          ? d.favorites.filter((x) => x !== id)
          : [id, ...d.favorites],
      }),
      true,
    );
  },
  dislike(id: string) {
    this.update((d) => ({ ...d, disliked: unique([...d.disliked, id]) }));
    if (data.queue[data.current] === id) this.next();
  },
  enqueue(ids: string[], next = false) {
    this.update((d) => ({
      ...d,
      queue: next
        ? [
            ...d.queue.slice(0, d.current + 1),
            ...ids,
            ...d.queue.slice(d.current + 1),
          ]
        : [...d.queue, ...ids],
    }));
  },
  playList(ids: string[], index = 0) {
    radioAbort?.abort();
    let queue = [...ids];
    if (data.shuffle) queue = shuffleTail(queue, index);
    this.update((d) => ({ ...d, queue, current: index, position: 0 }));
    void this.playCurrent();
  },
  async playCurrent(position = 0) {
    const id = data.queue[data.current];
    if (!id || !data.tracks[id]) return;
    const t = data.tracks[id];
    this.update((d) => {
      const prior = d.listening[id] || {
        plays: 0,
        seconds: 0,
        skips: 0,
        last: 0,
        failed: 0,
      };
      return {
        ...d,
        history: unique([id, ...d.history]).slice(0, 1000),
        listening: { ...d.listening, [id]: { ...prior, last: Date.now() } },
        position,
      };
    });
    await player.load(t, data.settings, position);
    const next = data.queue[data.current + 1];
    if (next) void player.prefetch(next, data.settings);
    void this.fillRadio();
  },
  toggle() {
    if (playback.status === "playing" || playback.status === "loading")
      player.pause();
    else if (playback.trackId === data.queue[data.current] && playback.engine)
      void player.play();
    else void this.playCurrent(data.position);
  },
  next(ended = false) {
    if (!ended && data.queue[data.current]) {
      const id = data.queue[data.current];
      this.update((d) => {
        const stat = d.listening[id] || {
          plays: 0,
          seconds: 0,
          skips: 0,
          last: 0,
          failed: 0,
        };
        return {
          ...d,
          listening: {
            ...d.listening,
            [id]: {
              ...stat,
              skips:
                stat.skips +
                (playback.position < Math.min(playback.duration * 0.5, 90)
                  ? 1
                  : 0),
            },
          },
        };
      });
    }
    const index = nextIndex(data, ended);
    if (index < 0) {
      player.stop();
      if (data.radio) void this.fillRadio(true);
      return;
    }
    this.update((d) => ({ ...d, current: index, position: 0 }));
    void this.playCurrent();
  },
  previous() {
    if (playback.position > 3) {
      player.seek(0);
      return;
    }
    if (data.current > 0) {
      this.update((d) => ({ ...d, current: d.current - 1, position: 0 }));
      void this.playCurrent();
    }
  },
  removeQueue(index: number) {
    const current = index === data.current;
    this.update((d) => ({
      ...d,
      queue: d.queue.filter((_, i) => i !== index),
      current:
        index < d.current
          ? d.current - 1
          : Math.min(d.current, d.queue.length - 2),
    }));
    if (current) {
      if (data.current >= 0) void this.playCurrent();
      else player.stop();
    }
  },
  shuffle() {
    this.update((d) => ({
      ...d,
      shuffle: !d.shuffle,
      queue: !d.shuffle ? shuffleTail(d.queue, d.current) : d.queue,
    }));
  },
  settings(patch: Partial<Settings>) {
    this.update((d) => ({ ...d, settings: { ...d.settings, ...patch } }));
    piped.preferred = data.settings.instance;
  },
  async startRadio(track: Track) {
    this.addTracks([track]);
    this.update((d) => ({ ...d, radio: true }));
    this.playList([track.id]);
  },
  async fillRadio(resume = false) {
    if (!data.radio || radioPending || data.queue.length - data.current > 4)
      return;
    const seed = data.tracks[data.queue[data.current]];
    if (!seed) return;
    radioPending = true;
    radioAbort?.abort();
    radioAbort = new AbortController();
    const signal = radioAbort.signal;
    try {
      const candidates = await recommend(seed, data, signal);
      if (signal.aborted || !data.radio) return;
      this.addTracks(candidates);
      const excluded = new Set(data.queue);
      const ids = candidates
        .map((t) => t.id)
        .filter((id) => !excluded.has(id) && !data.disliked.includes(id));
      this.enqueue(ids.slice(0, 8));
      if (resume && ids.length) this.next(true);
      if (!ids.length)
        this.notify("推薦候補が不足しています。別の曲を基準にしてください。");
    } catch (e) {
      if (!signal.aborted)
        this.notify(e instanceof Error ? e.message : String(e));
    } finally {
      radioPending = false;
    }
  },
  undo() {
    const prev = previous.pop();
    if (!prev) return;
    future.push(structuredClone(data));
    this.update((d) => ({
      ...d,
      tracks: { ...d.tracks, ...prev.tracks },
      playlists: prev.playlists,
      favorites: prev.favorites,
    }));
  },
  redo() {
    const next = future.pop();
    if (!next) return;
    previous.push(structuredClone(data));
    this.update((d) => ({
      ...d,
      tracks: { ...d.tracks, ...next.tracks },
      playlists: next.playlists,
      favorites: next.favorites,
    }));
  },
  async flush() {
    if (!savingBlocked && loaded) await saveData(data);
  },
};
player.onState = (s) => {
  playback = s;
  emit();
  if (Date.now() - lastPositionSave > 5000) {
    lastPositionSave = Date.now();
    data = { ...data, position: s.position };
    persist();
  }
};
player.onMetadata = (t) => store.addTracks([t]);
player.onEnded = () => store.next(true);
player.onFailure = (id) => {
  store.update((d) => {
    const old = d.listening[id] || {
      plays: 0,
      seconds: 0,
      skips: 0,
      last: 0,
      failed: 0,
    };
    return {
      ...d,
      listening: { ...d.listening, [id]: { ...old, failed: old.failed + 1 } },
    };
  });
};
let listenedId = "";
let thisSessionSeconds = 0;
let counted = false;
player.onListen = (seconds) => {
  const id = data.queue[data.current];
  if (!id) return;
  if (listenedId !== id) {
    listenedId = id;
    thisSessionSeconds = 0;
    counted = false;
  }
  thisSessionSeconds += seconds;
  const old = data.listening[id] || {
    plays: 0,
    seconds: 0,
    skips: 0,
    last: 0,
    failed: 0,
  };
  const count =
    !counted &&
    thisSessionSeconds >= Math.min(30, Math.max(5, playback.duration * 0.5));
  if (count) counted = true;
  data = {
    ...data,
    listening: {
      ...data.listening,
      [id]: {
        ...old,
        seconds: old.seconds + seconds,
        plays: old.plays + (count ? 1 : 0),
        last: Date.now(),
      },
    },
  };
};
piped.onHealth = () => {
  healthRevision++;
  emit();
};
if ("mediaSession" in navigator) {
  const actions: Partial<
    Record<MediaSessionAction, MediaSessionActionHandler>
  > = {
    play: () => void player.play(),
    pause: () => player.pause(),
    stop: () => player.stop(),
    nexttrack: () => store.next(),
    previoustrack: () => store.previous(),
    seekto: (d) => player.seek(d.seekTime || 0),
    seekforward: (d) => player.seek(playback.position + (d.seekOffset || 10)),
    seekbackward: (d) => player.seek(playback.position - (d.seekOffset || 10)),
  };
  for (const [name, fn] of Object.entries(actions))
    try {
      navigator.mediaSession.setActionHandler(name as MediaSessionAction, fn!);
    } catch {}
}
window.addEventListener("pagehide", () => {
  data = { ...data, position: player.state.position };
  if (!savingBlocked && loaded) {
    try {
      sessionStorage.setItem("musicpleasure-recovery", JSON.stringify(data));
    } catch {}
  }
  void store.flush();
});
window.addEventListener("online", () =>
  store.notify("接続が復旧しました。再生・検索を再試行できます。"),
);
export const useStore = () =>
  useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    () => snapshot,
  );
