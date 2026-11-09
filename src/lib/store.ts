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
import { reliability, classify } from "./reliability";
import { QueueTraversal } from "./sequence";
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
let radioPending: Promise<void> | undefined;
let prefetchAbort: AbortController | undefined;
let radioEpoch = 0;
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
    await reliability.init();
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
    radioEpoch++;
    radioPending = undefined;
    let queue = [...ids];
    if (data.shuffle) queue = shuffleTail(queue, index);
    this.update((d) => ({ ...d, queue, current: index, position: 0 }));
    void this.playCurrent();
  },
  async playCurrent(position = 0, forceFirst = true) {
    prefetchAbort?.abort();
    await traversal.run(data.current, position, forceFirst);
    const id = data.queue[data.current];
    if (player.state.status === "playing" && player.state.trackId === id) {
      prefetchAbort = new AbortController();
      const signal = prefetchAbort.signal;
      const next = data.queue
        .slice(data.current + 1)
        .filter((id) => !reliability.isExcluded(id))
        .slice(0, 2);
      void (async () => {
        for (const id of next) {
          if (signal.aborted) return;
          await player.prefetch(id, data.settings, signal);
        }
      })();
      void this.fillRadio();
    }
  },
  toggle() {
    if (playback.status === "playing" || playback.status === "loading")
      player.pause();
    else if (playback.trackId === data.queue[data.current] && playback.engine)
      void player.play();
    else void this.playCurrent(data.position);
  },
  next(ended = false) {
    if (
      !ended &&
      data.queue[data.current] &&
      ["playing", "paused"].includes(playback.status)
    ) {
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
      const epoch = radioEpoch;
      if (data.radio)
        void this.fillRadio().then(() => {
          if (epoch !== radioEpoch) return;
          if (data.queue.length > data.current + 1) this.next(true);
        });
      return;
    }
    this.update((d) => ({ ...d, current: index, position: 0 }));
    void this.playCurrent(0, false);
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
  async fillRadio() {
    if (!data.radio || data.queue.length - data.current > 4) return;
    if (radioPending) return radioPending;
    const seed = data.tracks[data.queue[data.current]];
    if (!seed) return;
    const epoch = radioEpoch;
    radioAbort?.abort();
    radioAbort = new AbortController();
    const signal = radioAbort.signal;
    const job = (async () => {
      try {
        const candidates = await recommend(seed, data, signal);
        if (signal.aborted || epoch !== radioEpoch || !data.radio) return;
        const good: Track[] = [];
        const pool = candidates
          .filter(
            (t) =>
              !reliability.isExcluded(t.id) &&
              !data.queue.includes(t.id) &&
              !data.disliked.includes(t.id),
          )
          .slice(0, 8);
        // Decode candidates silently before they become radio queue entries. Metadata alone is insufficient.
        for (let i = 0; i < pool.length && good.length < 4; i += 2) {
          const results = await Promise.all(
            pool.slice(i, i + 2).map(async (t) => ({
              t,
              prepared: await player.prefetch(t.id, data.settings, signal),
            })),
          );
          if (signal.aborted || epoch !== radioEpoch || !data.radio) return;
          good.push(...results.filter((x) => x.prepared).map((x) => x.t));
        }
        if (signal.aborted || epoch !== radioEpoch || !data.radio) return;
        this.addTracks(good);
        const existing = new Set(data.queue);
        this.enqueue(good.map((t) => t.id).filter((id) => !existing.has(id)));
        if (!good.length)
          this.notify(
            "推薦候補は見つかりましたが、再生可能な音源を確認できませんでした。既存のキューは保持しています。",
          );
      } catch (e) {
        if (!signal.aborted)
          this.notify(e instanceof Error ? e.message : String(e));
      }
    })();
    radioPending = job;
    try {
      await job;
    } finally {
      if (radioPending === job) radioPending = undefined;
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
const traversal = new QueueTraversal({
  queue: () => data.queue,
  current: () => data.current,
  track: (id) => data.tracks[id],
  excluded: (id) => reliability.isExcluded(id),
  wrap: () => data.repeat === "all",
  select: (index) =>
    store.update((d) => ({ ...d, current: index, position: 0 })),
  load: async (t, position) => {
    store.update((d) => {
      const stat = d.listening[t.id] || {
        plays: 0,
        seconds: 0,
        skips: 0,
        last: 0,
        failed: 0,
      };
      return {
        ...d,
        history: unique([t.id, ...d.history]).slice(0, 1000),
        listening: { ...d.listening, [t.id]: { ...stat, last: Date.now() } },
        position,
      };
    });
    return player.load(t, data.settings, position);
  },
  skip: (id, detail) => {
    reliability.record({
      trackId: id,
      instance: "",
      stage: "queue",
      outcome: "skip",
      detail,
    });
    store.notify(
      `再生できない曲をスキップしました：${data.tracks[id]?.title || id}`,
    );
  },
  replenish: async () => {
    if (data.radio) await store.fillRadio();
  },
  exhausted: (track, count) => {
    if (track)
      player.unavailable(
        track,
        `確認した${count}曲に再生可能な曲がありません。キューを保持しました。接続回復後に再試行できます。`,
      );
    store.notify(
      `再生可能な曲を確認できず停止しました（${count}曲確認）。無限再試行は行いません。`,
    );
  },
});
player.onIntent = () => {
  traversal.cancel();
  radioEpoch++;
  radioAbort?.abort();
  radioPending = undefined;
  prefetchAbort?.abort();
};
player.onTerminalFailure = (id) => {
  if (
    !traversal.running &&
    data.queue[data.current] === id &&
    playback.status === "error"
  ) {
    if (
      data.current + 1 < data.queue.length ||
      data.repeat === "all" ||
      data.radio
    )
      store.next();
  }
};
reliability.onChange = () => {
  healthRevision++;
  emit();
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
    play: () => {
      if (playback.status !== "playing") store.toggle();
    },
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
