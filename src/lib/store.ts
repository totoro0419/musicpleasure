import { useSyncExternalStore } from "react";
import type { Data, Track, Settings } from "../types";
import {
  emptyData,
  newPlaylist,
  unique,
  move,
  nextIndex,
  shuffleTail,
} from "./model";
import { readData, saveData, storageRevision } from "./storage";
import { player } from "./player";
import { invidious } from "./invidious";
import { recommend } from "./recommend";
import { reliability } from "./reliability";
import { QueueTraversal } from "./sequence";
import { reconcileLocal, savedAudio } from "./local-audio";
let data = emptyData();
let playback = player.state;
let notice = "";
let loaded = false;
let savingBlocked = false;
let revision = 0;
let healthRevision = 0;
let radioStatus: { phase: "idle" | "finding" | "ready" | "error"; message: string } = { phase: "idle", message: "" };
let snapshot = { data, playback, notice, loaded, revision, healthRevision, radioStatus };
const listeners = new Set<() => void>();
let radioAbort: AbortController | undefined;
let radioPending: Promise<void> | undefined;
let prefetchAbort: AbortController | undefined;
let prefetchTimer: ReturnType<typeof setTimeout> | undefined;
function nextPreparedId(d: Data) {
  const index = nextIndex(d, true);
  return index < 0 ? "" : d.queue[index] || "";
}
let radioEpoch = 0;
function resetRadioWork() {
  radioEpoch++;
  radioAbort?.abort();
  radioPending = undefined;
  radioStatus = { phase: "idle", message: "" };
}
function withoutUpcomingRecommendations(d: Data) {
  const generated = new Set(d.radioGenerated);
  return d.queue.filter((id, index) => index <= d.current || !generated.has(id));
}
function radioSeed(d: Data) {
  return d.tracks[d.radioSeed || ""] || d.tracks[d.queue[d.current]];
}
async function waitForRadio() {
  while (data.radio) {
    const epoch = radioEpoch;
    const size = data.queue.length;
    const job = store.fillRadio();
    let change: () => void = () => {};
    try {
      await Promise.race([job, new Promise<void>((resolve) => {
        change = () => {
          if (epoch !== radioEpoch || data.queue.length > size) resolve();
        };
        listeners.add(change);
      })]);
    } finally {
      listeners.delete(change);
    }
    if (data.queue.length > size || epoch === radioEpoch) return;
  }
}
let lastPositionSave = 0;
let nearEndPrepared = "";
let waitingForRadio = false;
let advanceRequest = 0;
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
    radioStatus,
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
      data = { ...data, tracks: await reconcileLocal(data.tracks) };
    } catch (e) {
      savingBlocked = true;
      notice = `保存データを読み込めません。元データ保護のため自動保存を停止しました。バックアップの読み込みで復元してください：${e instanceof Error ? e.message : String(e)}`;
    }
    await reliability.init();
    loaded = true;
    invidious.preferred = data.settings.instance;
    emit();
    void invidious.init();
  },
  update(fn: (d: Data) => Data, undo = false) {
    const oldNext = nextPreparedId(data);
    const wasRadio = data.radio;
    const nextData = fn(data);
    if (undo) {
      previous.push(structuredClone(data));
      previous = previous.slice(-30);
      future = [];
    }
    data = nextData;
    if (data.settings.instance !== invidious.preferred) invidious.preferred = data.settings.instance;
    if (oldNext !== nextPreparedId(data)) { prefetchAbort?.abort(); clearTimeout(prefetchTimer); }
    if (wasRadio && !data.radio) resetRadioWork();
    persist();
    emit();
    if (oldNext !== nextPreparedId(data) && playback.status === "playing") this.prepareNext();
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
    const playlist = data.playlists.find((p) => p.id === id);
    if (!playlist) {
      this.notify("追加先が見つかりません。プレイリストを選び直してください。");
      return;
    }
    ids = unique(ids).filter((id) => data.tracks[id] && !playlist.tracks.includes(id));
    if (!ids.length) {
      this.notify("選択した曲はこのプレイリストに登録済みです。");
      return;
    }
    this.update(
      (d) => ({
        ...d,
        playlists: d.playlists.map((p) =>
          p.id === id ? { ...p, tracks: unique([...p.tracks, ...ids]) } : p,
        ),
        additions: { ...d.additions, ...Object.fromEntries(ids.map((id) => [id, (d.additions?.[id] || 0) + 1])) },
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
    this.update((d) => ({ ...d, disliked: unique([...d.disliked, id]), queue: d.queue.filter((x, i) => x !== id || i <= d.current) }));
    if (data.queue[data.current] === id) this.next();
  },
  enqueue(ids: string[], next = false) {
    this.update((d) => ({
      ...d,
      current: Math.max(0, d.current),
      radioGenerated: d.radioGenerated?.filter((id) => !ids.includes(id)),
      queue: next
        ? [
            ...d.queue.slice(0, d.current + 1),
            ...ids,
            ...d.queue.slice(d.current + 1),
          ]
        : [...d.queue, ...ids],
    }));
  },
  playList(ids: string[], index = 0, disableRadio = false) {
    if (!ids.length) return;
    resetRadioWork();
    let queue = [...ids];
    if (data.shuffle) queue = shuffleTail(queue, index);
    this.update((d) => ({
      ...d,
      queue,
      current: index,
      position: 0,
      radio: disableRadio ? false : d.radio,
      radioSeed: undefined,
      radioGenerated: [],
    }));
    void this.playCurrent();
    if (data.radio) void this.fillRadio();
  },
  async playCurrent(position = 0, forceFirst = true) {
    waitingForRadio = false;
    advanceRequest++;
    nearEndPrepared = "";
    listenedId = "";
    prefetchAbort?.abort();
    clearTimeout(prefetchTimer);
    await traversal.run(data.current, position, forceFirst);
    const id = data.queue[data.current];
    if (player.state.status === "playing" && player.state.trackId === id) {
      this.prepareNext();
      void this.fillRadio();
    }
  },
  prepareNext() {
    clearTimeout(prefetchTimer);
    prefetchTimer = setTimeout(() => {
      if (playback.status !== "playing" || navigator.onLine === false || data.settings.prefetch === false) return;
      const id = nextPreparedId(data);
      if (!id || data.tracks[id]?.source === "local" || reliability.isExcluded(id)) return;
      prefetchAbort?.abort(); prefetchAbort = new AbortController();
      void player.prefetch(id, data.settings, prefetchAbort.signal);
    }, 350);
  },
  seek(position: number) {
    const track = data.tracks[data.queue[data.current]];
    if (!track) return;
    if (playback.trackId === track.id && playback.engine && playback.status !== "loading") {
      player.seek(position);
      position = playback.position;
    }
    this.update((d) => ({ ...d, position }));
  },
  toggle() {
    if (!data.queue[data.current]) return;
    if (waitingForRadio || playback.status === "playing" || playback.status === "loading")
      player.pause();
    else if (
      ["paused", "blocked"].includes(playback.status) &&
      playback.trackId === data.queue[data.current] &&
      playback.engine
    )
      void player.play().then((result) => {
        if (result.status === "playing") {
          this.prepareNext();
          void this.fillRadio();
        }
      });
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
    const atRadioTail = data.radio && data.current + 1 >= data.queue.length &&
      (!ended || data.repeat !== "one");
    if (atRadioTail) {
      if (waitingForRadio) return;
      const request = ++advanceRequest;
      waitingForRadio = true;
      player.stop(false);
      void traversal.run(data.current + 1, 0, false).finally(() => {
        if (request === advanceRequest) waitingForRadio = false;
      });
      return;
    }
    const index = nextIndex(data, ended);
    if (index < 0) {
      player.stop();
      return;
    }
    this.update((d) => ({ ...d, current: index, position: 0 }));
    void this.playCurrent(0, false);
  },
  previous() {
    if (playback.engine && playback.trackId === data.queue[data.current] && playback.position > 3) {
      this.seek(0);
      return;
    }
    if (data.current > 0) {
      this.update((d) => ({ ...d, current: d.current - 1, position: 0 }));
      void this.playCurrent();
    }
  },
  selectQueue(index: number) {
    if (index < 0 || index >= data.queue.length) return;
    this.update((d) => ({ ...d, current: index, position: 0 }));
    void this.playCurrent();
  },
  moveQueue(from: number, to: number) {
    this.update((d) => {
      const order = move(d.queue.map((_, index) => index), from, to);
      return { ...d, queue: order.map((index) => d.queue[index]), current: order.indexOf(d.current) };
    });
  },
  removeQueue(index: number) {
    if (index < 0 || index >= data.queue.length) return;
    const current = index === data.current;
    const wasPlaying = ["playing", "loading"].includes(playback.status) || waitingForRadio;
    this.update((d) => ({
      ...d,
      queue: d.queue.filter((_, i) => i !== index),
      current: index < d.current ? d.current - 1 : Math.min(d.current, d.queue.length - 2),
      position: current ? 0 : d.position,
      radio: d.queue.length === 1 ? false : d.radio,
    }));
    if (current) {
      listenedId = "";
      if (data.current >= 0 && wasPlaying) void this.playCurrent();
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
    const changedMode = patch.radioMode !== undefined && patch.radioMode !== data.settings.radioMode;
    const changedAudio = patch.quality !== undefined || patch.instance !== undefined;
    const refilter = changedMode || patch.discovery !== undefined || patch.weights !== undefined;
    if (refilter || changedAudio) resetRadioWork();
    if (changedAudio || patch.prefetch === false) {
      prefetchAbort?.abort();
      clearTimeout(prefetchTimer);
    }
    this.update((d) => ({
      ...d,
      settings: { ...d.settings, ...patch },
      queue: d.radio && changedMode
        ? withoutUpcomingRecommendations(d)
        : d.queue,
      radioGenerated: changedMode ? [] : d.radioGenerated,
    }));
    this.prepareNext();
    if (data.radio && (refilter || changedAudio)) void this.fillRadio();
  },
  startRadio(track: Track, mode = data.settings.radioMode) {
    if (data.radio && data.radioSeed === track.id && data.settings.radioMode === mode && playback.status === "loading") return;
    const keepPlaying = playback.status === "playing" && playback.trackId === track.id;
    resetRadioWork();
    this.update((d) => ({
      ...d,
      tracks: { ...d.tracks, [track.id]: track },
      queue: [track.id],
      current: 0,
      position: keepPlaying ? playback.position : 0,
      radio: true,
      radioSeed: track.id,
      radioGenerated: [],
      settings: { ...d.settings, radioMode: mode },
    }));
    if (keepPlaying) traversal.cancel();
    else void this.playCurrent();
    void this.fillRadio();
  },
  stopRadio() {
    if (waitingForRadio) {
      traversal.cancel();
      waitingForRadio = false;
      advanceRequest++;
    }
    this.update((d) => ({ ...d, radio: false, radioGenerated: [] }));
  },
  refreshRadio() {
    if (!data.radio) return;
    resetRadioWork();
    this.update((d) => ({ ...d, queue: withoutUpcomingRecommendations(d), radioGenerated: [] }));
    this.retryRadio();
  },
  retryRadio() {
    if (!data.radio) return;
    if (["idle", "ended", "error"].includes(playback.status)) this.next(true);
    else void this.fillRadio();
  },
  async fillRadio() {
    if (!data.radio || data.queue.length - data.current > 4) return;
    if (radioPending) return radioPending;
    const current = data.tracks[data.queue[data.current]];
    const fixedSeed = ["channel", "versions", "covers"].includes(data.settings.radioMode);
    const seed = (fixedSeed ? radioSeed(data) : current) || radioSeed(data);
    if (!seed) return;
    const control = new AbortController();
    radioAbort = control;
    const { signal } = control;
    const active = () => !signal.aborted && data.radio && radioAbort === control;
    radioStatus = { phase: "finding", message: "" };
    emit();
    const job = (async () => {
      try {
        const candidates = await recommend(seed, data, signal);
        if (!active()) return;
        const eligible = (t: Track) =>
          !data.queue.includes(t.id) && !data.disliked.includes(t.id) && !reliability.isExcluded(t.id);
        const pool = candidates.filter(eligible).slice(0, 8);
        const prepare = async (track: Track) => track.source === "local"
          ? !!(await savedAudio(track.id))
          : !!(await player.prefetch(track.id, data.settings, signal, true));
        let added = 0;
        // Publish each verified track while the next candidates are still being checked.
        for (let i = 0; i < pool.length && added < 3; i += 2) {
          const pair = pool.slice(i, i + 2).map((track) => ({
            track, prepared: prepare(track).catch(() => false),
          }));
          for (const { track, prepared } of pair) {
            if (!await prepared || !active() || !eligible(track)) continue;
            added++;
            this.update((d) => ({
              ...d,
              tracks: { ...d.tracks, [track.id]: track },
              queue: [...d.queue, track.id],
              radioGenerated: [...(d.radioGenerated || []), track.id],
            }));
            if (added === 3) break;
          }
          if (!active()) return;
        }
        if (!active()) return;
        radioStatus = added
          ? { phase: "ready", message: "" }
          : { phase: "error", message: candidates.length
            ? "候補の音声を再生できませんでした。接続を確認して再試行するか、別の基準曲を選んでください。"
            : "次に再生できる曲が見つかりません。別の基準曲やおすすめの方向を選んでください。" };
      } catch (e) {
        if (active()) radioStatus = { phase: "error", message: e instanceof Error ? e.message : String(e) };
      } finally {
        if (active()) emit();
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
      tracks: { ...prev.tracks, ...d.tracks },
      playlists: prev.playlists,
      favorites: prev.favorites,
      additions: prev.additions,
    }));
  },
  redo() {
    const next = future.pop();
    if (!next) return;
    previous.push(structuredClone(data));
    this.update((d) => ({
      ...d,
      tracks: { ...next.tracks, ...d.tracks },
      playlists: next.playlists,
      favorites: next.favorites,
      additions: next.additions,
    }));
  },
  async flush() {
    if (savingBlocked) throw Error("元データ保護のため自動保存を停止しています。バックアップを復元してください。");
    if (loaded) await saveData(data);
  },
};
const traversal = new QueueTraversal({
  queue: () => data.queue,
  current: () => data.current,
  track: (id) => data.tracks[id],
  excluded: (id) => data.tracks[id]?.source === "local" ? !data.tracks[id]?.local?.available : navigator.onLine === false || reliability.isExcluded(id),
  wrap: () => data.repeat === "all" && !data.radio,
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
    if (data.radio) await waitForRadio();
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
player.onIntent = (kind) => {
  traversal.cancel();
  waitingForRadio = false;
  advanceRequest++;
  if (kind === "stop") resetRadioWork();
  prefetchAbort?.abort();
  clearTimeout(prefetchTimer);
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
  if (s.status === "playing" && s.position > 0 && s.duration - s.position < 25 && nearEndPrepared !== s.trackId) {
    nearEndPrepared = s.trackId;
    store.prepareNext();
    if (radioStatus.phase !== "error") void store.fillRadio();
  }
  if (s.trackId === data.queue[data.current] && s.engine && s.status !== "loading" && Date.now() - lastPositionSave > 5000) {
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
  if (!id || id !== playback.trackId) return;
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
    history: data.history[0] === id ? data.history : unique([id, ...data.history]).slice(0, 1000),
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
invidious.onHealth = () => {
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
  if (player.state.engine && player.state.trackId === data.queue[data.current])
    data = { ...data, position: player.audio.currentTime };
  if (!savingBlocked && loaded) {
    try {
      sessionStorage.setItem("musicpleasure-recovery", JSON.stringify({ ...data, __revision: storageRevision() }));
    } catch {}
  }
  void store.flush().catch(() => {});
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
