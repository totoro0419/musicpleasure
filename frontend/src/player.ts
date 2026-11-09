import { create } from "zustand";
import { db } from "./db";
import { useStore } from "./store";
import { createJob, jobs, fetchAudio } from "./api";
import type { Track, DownloadJob } from "./types";
import type { YouTubeController } from "./youtube";
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
  engine: "audio" | "youtube" | null;
  videoId: string;
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
  videoId: "",
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
async function cachedAudio(track: Track): Promise<Blob | undefined> {
  for (const source of track.sources) {
    const cached = await db.assets.get(source.id);
    if (cached) return cached.blob;
  }
}
export async function ensureAudio(track: Track): Promise<Blob> {
  const cached = await cachedAudio(track);
  if (cached) return cached;
  const source = track.sources.find(
    (s) => s.provider === "youtube" && s.videoId,
  );
  if (!source?.videoId)
    throw new Error("音声が端末にありません。MP3を再度読み込んでください");
  if (pending.has(source.id)) return pending.get(source.id)!;
  const task = (async () => {
    let job = await createJob(source.videoId!);
    let tries = 0;
    while (!["ready", "failed", "cancelled"].includes(job.state)) {
      if (tries++ > 310) throw new Error("音源の準備がタイムアウトしました");
      await delay(1000);
      const all = await pollJobs();
      usePlayback.setState({ jobs: all });
      const updated = all.find((j) => j.id === job.id);
      if (!updated) throw new Error("音声ジョブが削除されました");
      job = updated;
    }
    usePlayback.setState((s) => ({
      jobs: [job, ...s.jobs.filter((j) => j.id !== job.id)],
    }));
    if (job.state !== "ready")
      throw new Error(job.error || "ダウンロードがキャンセルされました");
    const blob = await fetchAudio(job.id);
    try {
      await db.assets.put({
        id: source.id,
        sourceId: source.id,
        blob,
        bytes: blob.size,
        createdAt: Date.now(),
      });
      usePlayback.setState((s) => ({ cacheRevision: s.cacheRevision + 1 }));
    } catch {
      throw new Error(
        "MP3の端末内保存に失敗しました。空き容量を確認してください",
      );
    }
    return blob;
  })().finally(() => pending.delete(source.id));
  pending.set(source.id, task);
  return task;
}
let generation = 0,
  objectUrl = "",
  intent = false,
  loading = false,
  lastSave = 0,
  recorded = false;
let youtube: YouTubeController | undefined;
function metadata(t: Track) {
  if ("mediaSession" in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.title, artist: t.artist,
      artwork: t.thumbnail ? [{ src: t.thumbnail }] : [],
    });
  }
}
function recordCurrentPlay() {
  if (recorded) return;
  const s = useStore.getState(), e = s.queue.find(q => q.id === s.currentId);
  if (e) s.recordPlay(e.trackId);
  recorded = true;
}
function savePosition(time: number, duration: number) {
  if (!Number.isFinite(time) || !Number.isFinite(duration) || duration <= 0) return;
  usePlayback.setState({time, duration});
  if (Date.now() - lastSave > 2000) {
    useStore.setState({position: time});
    lastSave = Date.now();
  }
}
export function connectYouTube(run: number, controller: YouTubeController) {
  if (run !== generation || usePlayback.getState().engine !== "youtube") return false;
  youtube = controller;
  loading = false;
  controller.setVolume(useStore.getState().settings.volume * 100);
  usePlayback.setState({ready: true});
  if (intent) controller.playVideo();
  else usePlayback.setState({status: "paused"});
  return true;
}
export function youtubeProgress(run: number, time: number, duration: number) {
  if (run === generation && usePlayback.getState().status === "playing") savePosition(time, duration);
}
export function youtubeState(run: number, state: number) {
  if (run !== generation || usePlayback.getState().engine !== "youtube") return;
  if (usePlayback.getState().status === "error") {
    if (state === 1) youtube?.pauseVideo();
    return;
  }
  if (state === 1) {
    intent = true;
    usePlayback.setState({status: "playing", error: "", notice: ""});
    recordCurrentPlay();
  } else if (state === 2 || state === 5) {
    usePlayback.setState({status: "paused"});
    if (state === 2) {
      intent = false;
      if (youtube) useStore.setState({position: youtube.getCurrentTime()});
    }
  } else if (state === 3) usePlayback.setState({status: "loading"});
  else if (state === 0) void next(true);
  if ("mediaSession" in navigator)
    navigator.mediaSession.playbackState = state === 1 && intent ? "playing" : "paused";
}
export function youtubeBlocked(run: number) {
  if (run !== generation) return;
  intent = false;
  usePlayback.setState({status: "paused", notice: "再生が保留されています。映像内の再生ボタンを押してください"});
}
export function youtubeFailure(run: number, error: string) {
  if (run !== generation) return;
  loading = false;
  intent = false;
  youtube?.pauseVideo();
  usePlayback.setState({status: "error", error, notice: "", ready: false});
}
export async function startCurrent(resume = true) {
  const s = useStore.getState(),
    entry = s.queue.find((q) => q.id === s.currentId),
    t = entry && s.tracks[entry.trackId];
  if (!t) return;
  const run = ++generation;
  intent = resume;
  loading = true;
  youtube?.pauseVideo();
  youtube = undefined;
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
  recorded = false;
  usePlayback.setState({
    status: "loading",
    error: "",
    time: s.position,
    duration: t.duration,
    engine: null, videoId: "", requestId: run, ready: false, notice: "",
  });
  try {
    const cached = await cachedAudio(t);
    if (run !== generation) return;
    const source = t.sources.find(s => s.provider === "youtube" && /^[\w-]{11}$/.test(s.videoId || ""));
    metadata(t);
    if (!cached && source?.videoId) {
      usePlayback.setState({engine: "youtube", videoId: source.videoId});
      return;
    }
    if (!cached) throw new Error("音声が端末にありません。MP3を再度読み込んでください");
    const blob = cached;
    if (run !== generation) return;
    loading = false;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(blob);
    usePlayback.setState({engine: "audio"});
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
    if (intent) await audio.play();
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
  if (usePlayback.getState().engine === "youtube" && youtube && usePlayback.getState().ready && status !== "error") {
    intent = !(status === "playing" || (status === "loading" && intent));
    if (intent) youtube.playVideo();
    else { youtube.pauseVideo(); usePlayback.setState({status: "paused"}); }
  } else if (loading) {
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
  if (usePlayback.getState().engine === "youtube") {
    if (!youtube || !usePlayback.getState().ready) return;
    const duration = youtube.getDuration();
    if (!Number.isFinite(duration) || duration <= 0) return;
    const target = Math.max(0, Math.min(time, duration));
    youtube.seekTo(target, true);
    usePlayback.setState({time: target, duration});
    useStore.setState({position: target});
    return;
  }
  if (!Number.isFinite(audio.duration)) return;
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
    if (usePlayback.getState().engine === "youtube") youtube?.playVideo();
    else await audio.play();
    return;
  }
  const n =
    i + 1 < s.queue.length ? i + 1 : s.settings.repeat === "all" ? 0 : -1;
  if (n < 0) {
    intent = false;
    youtube?.pauseVideo();
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
export function clearPlayback() {
  generation++;
  youtube?.pauseVideo();
  youtube = undefined;
  loading = false;
  intent = false;
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = "";
  useStore.setState({ currentId: null, position: 0 });
  usePlayback.setState({ status: "idle", time: 0, duration: 0, error: "", engine: null, videoId: "", ready: false, notice: "" });
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
  if (usePlayback.getState().engine !== "audio") return;
  usePlayback.setState({ status: "playing", error: "" });
  if ("mediaSession" in navigator)
    navigator.mediaSession.playbackState = "playing";
  recordCurrentPlay();
});
audio.addEventListener("pause", () => {
  if (usePlayback.getState().engine !== "audio") return;
  if (usePlayback.getState().status === "playing")
    usePlayback.setState({ status: "paused" });
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
  if (audio.src)
    usePlayback.setState({
      status: "error",
      error:
        "音声を再生できませんでした。再試行・次の曲へ進む操作を利用できます",
    });
});
useStore.subscribe((s) => {
  audio.volume = s.settings.volume;
  youtube?.setVolume(s.settings.volume * 100);
});
if ("mediaSession" in navigator) {
  for (const [action, handler] of Object.entries({
    play: () => {
      if (loading) {
        intent = true;
        usePlayback.setState({ status: "loading" });
      } else if (usePlayback.getState().status !== "playing")
        void togglePlayback();
    },
    pause: () => {
      intent = false;
      youtube?.pauseVideo();
      audio.pause();
      if (usePlayback.getState().engine === "youtube") usePlayback.setState({status: "paused"});
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
