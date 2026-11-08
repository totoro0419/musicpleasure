import { create } from "zustand";
import { db } from "./db";
import { useStore } from "./store";
import { createJob, jobs, fetchAudio } from "./api";
import type { Track, DownloadJob } from "./types";
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
}
export const usePlayback = create<Playback>(() => ({
  status: "idle",
  error: "",
  time: 0,
  duration: 0,
  jobs: [],
  cacheRevision: 0,
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
export async function ensureAudio(track: Track): Promise<Blob> {
  for (const source of track.sources) {
    const cached = await db.assets.get(source.id);
    if (cached) return cached.blob;
  }
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
  lastSave = 0,
  recorded = false;
export async function startCurrent(resume = true) {
  const s = useStore.getState(),
    entry = s.queue.find((q) => q.id === s.currentId),
    t = entry && s.tracks[entry.trackId];
  if (!t) return;
  const run = ++generation;
  intent = resume;
  audio.pause();
  recorded = false;
  usePlayback.setState({
    status: "loading",
    error: "",
    time: s.position,
    duration: t.duration,
  });
  try {
    const blob = await ensureAudio(t);
    if (run !== generation) return;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(blob);
    audio.src = objectUrl;
    audio.volume = s.settings.volume;
    audio.onloadedmetadata = () => {
      if (run !== generation) return;
      audio.currentTime = Math.min(
        s.position,
        Number.isFinite(audio.duration) ? audio.duration : 0,
      );
      usePlayback.setState({ duration: audio.duration });
      if (Number.isFinite(audio.duration))
        useStore.setState((v) => ({
          tracks: {
            ...v.tracks,
            [t.id]: { ...v.tracks[t.id], duration: audio.duration },
          },
        }));
    };
    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: t.title,
        artist: t.artist,
        artwork: t.thumbnail ? [{ src: t.thumbnail }] : [],
      });
    }
    if (intent) await audio.play();
    else usePlayback.setState({ status: "paused" });
  } catch (e) {
    if (run === generation)
      usePlayback.setState({
        status: "error",
        error: e instanceof Error ? e.message : "音声を再生できませんでした",
      });
  }
}
export async function playTracks(ts: Track[], index = 0) {
  useStore.getState().play(ts, index);
  await startCurrent();
}
export async function togglePlayback() {
  const status = usePlayback.getState().status;
  if (status === "playing") {
    intent = false;
    audio.pause();
  } else if (status === "loading") {
    intent = !intent;
    usePlayback.setState({ status: intent ? "loading" : "paused" });
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
    await audio.play();
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
  if (audio.currentTime > 3) {
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
  intent = false;
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = "";
  useStore.setState({ currentId: null, position: 0 });
  usePlayback.setState({ status: "idle", time: 0, duration: 0, error: "" });
}
export function shuffleQueue() {
  const s = useStore.getState(),
    others = s.queue.filter((q) => q.id !== s.currentId);
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
  usePlayback.setState({ status: "playing", error: "" });
  if ("mediaSession" in navigator)
    navigator.mediaSession.playbackState = "playing";
  if (!recorded) {
    const s = useStore.getState(),
      e = s.queue.find((q) => q.id === s.currentId);
    if (e) s.recordPlay(e.trackId);
    recorded = true;
    const i = s.queue.findIndex((q) => q.id === s.currentId),
      nextEntry = s.queue[i + 1];
    if (nextEntry)
      void ensureAudio(s.tracks[nextEntry.trackId]).catch(() => {});
  }
});
audio.addEventListener("pause", () => {
  if (usePlayback.getState().status === "playing")
    usePlayback.setState({ status: "paused" });
  if ("mediaSession" in navigator)
    navigator.mediaSession.playbackState = "paused";
});
audio.addEventListener("timeupdate", () => {
  usePlayback.setState({ time: audio.currentTime });
  if (Date.now() - lastSave > 2000) {
    useStore.setState({ position: audio.currentTime });
    lastSave = Date.now();
  }
});
audio.addEventListener("ended", () => {
  void next(true);
});
audio.addEventListener("error", () => {
  if (audio.src)
    usePlayback.setState({
      status: "error",
      error:
        "音声を再生できませんでした。再試行・次の曲へ進む操作を利用できます",
    });
});
useStore.subscribe((s) => {
  audio.volume = s.settings.volume;
});
if ("mediaSession" in navigator) {
  for (const [action, handler] of Object.entries({
    play: () => {
      void togglePlayback();
    },
    pause: () => audio.pause(),
    nexttrack: () => {
      void next();
    },
    previoustrack: () => {
      void previous();
    },
    seekto: (d: MediaSessionActionDetails) => seek(d.seekTime || 0),
    seekbackward: () => seek(audio.currentTime - 10),
    seekforward: () => seek(audio.currentTime + 10),
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
