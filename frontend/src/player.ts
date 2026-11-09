import { create } from "zustand";
import { db } from "./db";
import { useStore } from "./store";
import { createJob, jobs, fetchAudio } from "./api";
import type { Track, DownloadJob } from "./types";
import { cachedAudio, storeAudio, sourceKey } from "./cache";
export const audio = new Audio();
audio.preload = "metadata";
audio.hidden = true;
audio.dataset.player = "musicpleasure";
document.body.append(audio);
interface Playback {
  status: "idle" | "loading" | "playing" | "paused" | "error";
  error: string;
  time: number;
  duration: number;
  jobs: DownloadJob[];
  cacheRevision: number;
  engine: "audio" | null;
  phase: string;
  requestId: number;
  ready: boolean;
  notice: string;
}
export const usePlayback = create<Playback>(() => ({
  status: "idle",
  error: "",
  time: 0,
  duration: 0,
  jobs: [],
  cacheRevision: 0,
  engine: null,
  phase: "",
  requestId: 0,
  ready: false,
  notice: "",
}));
const pending = new Map<string, Promise<Blob>>();
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
let sharedJobs: Promise<DownloadJob[]> | undefined;
let jobsAt = 0;
function pollJobs() {
  if (!sharedJobs || Date.now() - jobsAt > 900) {
    jobsAt = Date.now();
    sharedJobs = jobs().catch((e) => {
      sharedJobs = undefined;
      throw e;
    });
  }
  return sharedJobs;
}
// All consumers share a task by video ID, including cache validation and writes.
let activeDownloads = 0;
const slots: (() => void)[] = [];
async function acquire() {
  if (activeDownloads >= 2) await new Promise<void>(resolve => slots.push(resolve));
  else activeDownloads++;
}
function release() {
  const next = slots.shift();
  if (next) next(); else activeDownloads--;
}
export function ensureAudio(track: Track): Promise<Blob> {
  const source = track.sources.find(s => s.provider === 'youtube' && s.videoId);
  const key = source ? sourceKey(source) : track.sources[0]?.id || track.id;
  if (pending.has(key)) return pending.get(key)!;
  const task = (async () => {
    const cached = await cachedAudio(track);
    if (cached) return cached;
    if (!source?.videoId) throw new Error('音声が端末にありません。MP3を再度読み込んでください');
    if (navigator.onLine === false) throw new Error('オフラインです。この曲は端末に保存されていません');
    await acquire();
    try {
      let job = await createJob(source.videoId);
      usePlayback.setState(s => ({ jobs: [job, ...s.jobs.filter(j => j.id !== job.id)] }));
      const deadline = Date.now() + 330000;
      while (!['ready', 'failed', 'cancelled'].includes(job.state)) {
        if (Date.now() > deadline) throw new Error('音源の準備がタイムアウトしました。再試行してください');
        await delay(1000);
        const all = await pollJobs();
        usePlayback.setState({ jobs: all });
        const updated = all.find(j => j.id === job.id);
        if (!updated) throw new Error('音源取得ジョブが見つかりません。再試行してください');
        job = updated;
      }
      if (job.state !== 'ready') throw new Error(job.error || '音源の取得が中止されました');
      const blob = await fetchAudio(job.id);
      await storeAudio(key, blob);
      usePlayback.setState(s => ({ cacheRevision: s.cacheRevision + 1 }));
      return blob;
    } finally { release(); }
  })().finally(() => pending.delete(key));
  pending.set(key, task);
  return task;
}
export async function saveTracks(tracks: Track[]) {
  let index = 0;
  const errors: string[] = [];
  await Promise.all(Array.from({ length: Math.min(2, tracks.length) }, async () => {
    while (index < tracks.length) {
      const t = tracks[index++];
      try { await ensureAudio(t); } catch(e) { errors.push(`${t.title}: ${e instanceof Error ? e.message : '取得失敗'}`); }
    }
  }));
  if (errors.length) throw new Error(errors.join(' / '));
}
let prefetched = '';
let prefetchBusy = false;
function prefetchNext() {
  const connection = (navigator as Navigator & {connection?: {saveData?: boolean; effectiveType?: string}}).connection;
  if (prefetchBusy || navigator.onLine === false || connection?.saveData || /(^|-)2g/.test(connection?.effectiveType || '')) return;
  const s = useStore.getState();
  if (s.settings.repeat === 'one') return;
  const index = s.queue.findIndex(q => q.id === s.currentId);
  const entry = s.queue[index + 1] || (s.settings.repeat === 'all' ? s.queue[0] : undefined);
  if (!entry || entry.id === s.currentId || prefetched === entry.id) return;
  const t = s.tracks[entry.trackId];
  if (!t) return;
  prefetched = entry.id;
  prefetchBusy = true;
  void ensureAudio(t).catch(() => { /* foreground play exposes a retryable error */ }).finally(() => { prefetchBusy = false; });
}
let generation = 0,
  objectUrl = "",
  intent = false,
  loading = false,
  lastSave = 0,
  recorded = false;

function metadata(t: Track) {
  if ("mediaSession" in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.title,
      artist: t.artist,
      artwork: t.thumbnail ? [{ src: t.thumbnail }] : [],
    });
  }
}
function recordCurrentPlay() {
  if (recorded) return;
  const s = useStore.getState(),
    e = s.queue.find((q) => q.id === s.currentId);
  if (e) s.recordPlay(e.trackId);
  recorded = true;
}
function savePosition(time: number, duration: number) {
  if (!Number.isFinite(time) || !Number.isFinite(duration) || duration <= 0)
    return;
  usePlayback.setState({ time, duration });
  if ('mediaSession' in navigator && navigator.mediaSession.setPositionState) {
    try { navigator.mediaSession.setPositionState({duration, playbackRate:1, position:Math.min(time,duration)}); } catch { /* unsupported platform */ }
  }
  if (Date.now() - lastSave > 2000) {
    useStore.setState({ position: time });
    lastSave = Date.now();
  }
}
export async function startCurrent(resume = true) {
  const s = useStore.getState(),
    entry = s.queue.find((q) => q.id === s.currentId),
    t = entry && s.tracks[entry.trackId];
  if (!t) return;
  const run = ++generation;
  intent = resume;
  loading = true;
  if ("mediaSession" in navigator)
    navigator.mediaSession.playbackState = "paused";
  usePlayback.setState({engine: null});
  audio.onloadedmetadata = null;
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
  recorded = false;
  usePlayback.setState({
    status: "loading",
    error: "",
    time: s.position,
    duration: t.duration,
    engine: null,
    requestId: run,
    ready: false,
    notice: "",
    phase: "音源を準備中",
  });
  try {
    const blob = await ensureAudio(t);
    if (run !== generation || useStore.getState().currentId !== entry.id) return;
    metadata(t);
    loading = false;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(blob);
    usePlayback.setState({ engine: "audio", phase: "再生可能" });
    audio.src = objectUrl;
    audio.volume = s.settings.volume;
    audio.onloadedmetadata = () => {
      if (run !== generation) return;
      audio.currentTime = Math.min(
        s.position,
        Number.isFinite(audio.duration) ? audio.duration : 0,
      );
      usePlayback.setState({ duration: audio.duration, ready: true });
      if (Number.isFinite(audio.duration))
        useStore.setState((v) => ({
          tracks: {
            ...v.tracks,
            [t.id]: { ...v.tracks[t.id], duration: audio.duration },
          },
        }));
    };
    if (intent) {
      await audio.play();
      if (run !== generation) return;
      if (!intent) audio.pause();
    }
    else usePlayback.setState({ status: "paused" });
  } catch (e) {
    if (run === generation) {
      loading = false;
      usePlayback.setState({
        status: "error",
        error: e instanceof Error ? e.message : "音声を再生できませんでした",
      });
    }
  }
}
export async function playTracks(ts: Track[], index = 0) {
  useStore.getState().play(ts, index);
  await startCurrent();
}
export async function togglePlayback() {
  const status = usePlayback.getState().status;
  if (loading) {
    intent = !intent;
    usePlayback.setState({ status: intent ? "loading" : "paused" });
  } else if (status === "playing") {
    intent = false;
    audio.pause();
  } else if (audio.src && status === "paused") {
    intent = true;
    try {
      await audio.play();
    } catch {
      usePlayback.setState({
        status: "error",
        error: "再生を開始できませんでした。もう一度押してください",
      });
    }
  } else await startCurrent();
}
export function seek(time: number) {
  if (!Number.isFinite(time)) return;
  if (!usePlayback.getState().ready || !Number.isFinite(audio.duration)) return;
  audio.currentTime = Math.max(0, Math.min(time, audio.duration));
  usePlayback.setState({ time: audio.currentTime });
  useStore.setState({ position: audio.currentTime });
}
export async function next(auto = false) {
  const s = useStore.getState(),
    i = s.queue.findIndex((q) => q.id === s.currentId);
  if (auto && s.settings.repeat === "one") {
    seek(0);
    intent = true;
    try { await audio.play(); } catch { usePlayback.setState({status: "error", error: "再生を再開できませんでした。再試行してください"}); }
    return;
  }
  const n =
    i + 1 < s.queue.length ? i + 1 : s.settings.repeat === "all" ? 0 : -1;
  if (n < 0) {
    intent = false;
    audio.pause();
    seek(0);
    usePlayback.setState({ status: "paused" });
    return;
  }
  s.setCurrent(s.queue[n].id);
  await startCurrent();
}
export async function previous() {
  if (usePlayback.getState().time > 3) {
    seek(0);
    return;
  }
  const s = useStore.getState(),
    i = s.queue.findIndex((q) => q.id === s.currentId);
  s.setCurrent(s.queue[Math.max(0, i - 1)]?.id || null);
  await startCurrent();
}
export function selectQueue(id: string) {
  useStore.getState().setCurrent(id);
  void startCurrent();
}
export function stopPlayback() {
  generation++;
  loading = false;
  intent = false;
  usePlayback.setState({engine:null, status:'paused', time:0, ready:false, phase:'', notice:''});
  audio.onloadedmetadata = null;
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = '';
  useStore.setState({position:0});
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState='paused';
}
export function clearPlayback() {
  generation++;
  prefetched = "";
  if ("mediaSession" in navigator)
    navigator.mediaSession.playbackState = "paused";
  loading = false;
  intent = false;
  usePlayback.setState({engine: null});
  audio.onloadedmetadata = null;
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = "";
  useStore.setState({ currentId: null, position: 0 });
  usePlayback.setState({
    status: "idle",
    time: 0,
    duration: 0,
    error: "",
    engine: null,
    phase: "",
    ready: false,
    notice: "",
  });
}
export function shuffleQueue() {
  const s = useStore.getState();
  if (s.settings.shuffle) {
    s.settingsUpdate({ shuffle: false });
    return;
  }
  const others = s.queue.filter((q) => q.id !== s.currentId);
  for (let i = others.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [others[i], others[j]] = [others[j], others[i]];
  }
  const current = s.queue.find((q) => q.id === s.currentId);
  useStore.setState({
    queue: current ? [current, ...others] : others,
    settings: { ...s.settings, shuffle: !s.settings.shuffle },
  });
}
audio.addEventListener("playing", () => {
  if (usePlayback.getState().engine !== "audio" || audio.paused) return;
  if (!intent) { audio.pause(); return; }
  usePlayback.setState({ status: "playing", error: "", phase: "オフライン再生可能" });
  if ("mediaSession" in navigator)
    navigator.mediaSession.playbackState = "playing";
  recordCurrentPlay();
  prefetchNext();
});
audio.addEventListener("pause", () => {
  if (usePlayback.getState().engine !== "audio") return;
  if (usePlayback.getState().status === "playing")
    usePlayback.setState({ status: "paused" });
  if (Number.isFinite(audio.currentTime)) useStore.setState({ position: audio.currentTime });
  if ("mediaSession" in navigator)
    navigator.mediaSession.playbackState = "paused";
});
audio.addEventListener("timeupdate", () => {
  if (usePlayback.getState().engine !== "audio") return;
  savePosition(audio.currentTime, audio.duration);
});
audio.addEventListener("ended", () => {
  if (usePlayback.getState().engine !== "audio") return;
  void next(true);
});
audio.addEventListener("error", () => {
  if (usePlayback.getState().engine !== "audio") return;
  if (audio.src) {
    intent = false;
    const s = useStore.getState(), t = s.tracks[s.queue.find(q => q.id === s.currentId)?.trackId || ""];
    if (t) for (const source of t.sources) void db.assets.delete(sourceKey(source));
    usePlayback.setState({
      status: "error",
      error:
        "音声を再生できませんでした。再試行・次の曲へ進む操作を利用できます",
    });
  }
});
useStore.subscribe((s, previous) => {
  audio.volume = s.settings.volume;
  if (previous.currentId && s.currentId !== previous.currentId && loading) {
    // setCurrent is normally followed synchronously by startCurrent; invalidate any old waiter.
    generation++;
    if (!s.currentId) clearPlayback();
  }
  if (s.queue !== previous.queue && usePlayback.getState().status === 'playing') prefetchNext();
});
if ("mediaSession" in navigator) {
  for (const [action, handler] of Object.entries({
    stop: stopPlayback,
    play: () => {
      if (loading) {
        intent = true;
        usePlayback.setState({ status: "loading" });
      } else if (usePlayback.getState().status !== "playing")
        void togglePlayback();
    },
    pause: () => {
      intent = false;
        audio.pause();
      if (loading) usePlayback.setState({ status: "paused" });
    },
    nexttrack: () => {
      void next();
    },
    previoustrack: () => {
      void previous();
    },
    seekto: (d: MediaSessionActionDetails) => seek(d.seekTime || 0),
    seekbackward: () => seek(usePlayback.getState().time - 10),
    seekforward: () => seek(usePlayback.getState().time + 10),
  }))
    try {
      navigator.mediaSession.setActionHandler(
        action as MediaSessionAction,
        handler,
      );
    } catch {
      /* platform may not support individual actions */
    }
}

usePlayback.subscribe((state, previous) => {
  if (state.jobs === previous.jobs) return;
  const s = useStore.getState();
  const track = s.tracks[s.queue.find(q => q.id === s.currentId)?.trackId || ''];
  const videoId = track?.sources.find(source => source.provider === 'youtube')?.videoId;
  const job = state.jobs.find(j => j.videoId === videoId);
  if (job && loading) usePlayback.setState({phase: ({queued: '音源を準備中', downloading: 'ダウンロード中', converting: 'MP3を変換中', ready: '端末に保存中', failed: '取得失敗', cancelled: '取得中止'})[job.state]});
});
