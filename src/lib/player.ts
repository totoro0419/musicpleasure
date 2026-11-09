import { piped, compatibleStreams } from "./piped";
import type { Settings, Track, StreamInfo } from "../types";
export type PlaybackStatus =
  "idle" | "loading" | "playing" | "paused" | "blocked" | "error" | "ended";
export interface PlaybackState {
  status: PlaybackStatus;
  engine: "piped" | null;
  position: number;
  duration: number;
  message: string;
  trackId: string;
  instance: string;
}
export class MusicPlayer {
  audio = new Audio();
  state: PlaybackState = {
    status: "idle",
    engine: null,
    position: 0,
    duration: 0,
    message: "",
    trackId: "",
    instance: "",
  };
  onState = (s: PlaybackState) => {};
  onEnded = () => {};
  onMetadata = (_track: Track) => {};
  onFailure = (_id: string) => {};
  onListen = (_seconds: number) => {};
  private epoch = 0;
  private abort?: AbortController;
  private endedEpoch = -1;
  private wantsPlay = false;
  private recovering = false;
  private current?: Track;
  private settings?: Settings;
  private watchdog?: ReturnType<typeof setTimeout>;
  private lastTick = 0;
  private lastProgress = 0;
  private audioConfirmed = false;
  private stallAt = 0;
  private recoveries = 0;
  private prefetchCache = new Map<
    string,
    { at: number; info: StreamInfo; instance: string }
  >();
  constructor() {
    this.audio.preload = "metadata";
    this.audio.volume = 0.8;
    setInterval(() => this.tick(), 500);
    this.audio.addEventListener("ended", () => {
      if (this.state.engine === "piped" && this.wantsPlay) this.finish();
    });
    this.audio.addEventListener("playing", () => {
      if (this.state.engine !== "piped" || !this.wantsPlay) {
        this.audio.pause();
        return;
      }
      this.set({ status: "playing", message: "" });
      this.stallAt = 0;
      this.armWatchdog(false);
    });
    this.audio.addEventListener("waiting", () => this.armWatchdog());
    this.audio.addEventListener("error", () => {
      if (this.state.engine === "piped" && this.state.status === "playing")
        void this.recover();
    });
    document.addEventListener("visibilitychange", () => this.tick());
  }
  private set(patch: Partial<PlaybackState>) {
    this.state = { ...this.state, ...patch };
    this.onState(this.state);
    if ("mediaSession" in navigator) {
      navigator.mediaSession.playbackState =
        this.state.status === "playing" ? "playing" : "paused";
      try {
        if (this.state.duration > 0)
          navigator.mediaSession.setPositionState({
            duration: this.state.duration,
            playbackRate: 1,
            position: Math.min(this.state.duration, this.state.position),
          });
      } catch {}
    }
  }
  private tick() {
    const now = Date.now();
    const position = this.audio.currentTime || 0;
    if (this.state.status === "playing") {
      if (this.lastTick && position > this.lastProgress)
        this.onListen(Math.min(2, (now - this.lastTick) / 1000));
      this.lastTick = now;
      if (position === this.lastProgress) {
        if (!this.stallAt) this.stallAt = now;
        else if (now - this.stallAt > 12000) void this.recover();
      } else {
        this.stallAt = 0;
        if (this.state.instance && this.lastProgress === 0 && position > 0) {
          this.audioConfirmed = true;
          piped.audioSuccess(this.state.instance);
        }
      }
    } else this.lastTick = 0;
    this.lastProgress = position;
    if (this.state.engine === "piped")
      this.set({
        position,
        duration: Number.isFinite(this.audio.duration)
          ? this.audio.duration
          : this.state.duration,
      });
  }
  private finish() {
    if (this.endedEpoch === this.epoch) return;
    this.endedEpoch = this.epoch;
    this.wantsPlay = false;
    this.armWatchdog(false);
    this.set({ status: "ended" });
    this.onEnded();
  }
  private armWatchdog(active = true) {
    clearTimeout(this.watchdog);
    if (active && this.wantsPlay)
      this.watchdog = setTimeout(() => void this.recover(), 12000);
  }
  private async recover() {
    if (this.recovering || !this.current || !this.settings || !this.wantsPlay)
      return;
    if (++this.recoveries > 2) {
      this.pause();
      this.set({
        status: "error",
        message:
          "Pipedの音声が繰り返し停止しました。接続先の再評価後に再試行してください。",
      });
      return;
    }
    this.recovering = true;
    const pos = this.state.position;
    piped.failure(this.state.instance, "音声が停止したため別のPipedで再取得");
    try {
      await this.load(this.current, this.settings, pos, true);
    } finally {
      this.recovering = false;
    }
  }
  stop() {
    this.epoch++;
    this.abort?.abort();
    this.wantsPlay = false;
    this.audio.pause();
    this.audio.removeAttribute("src");
    this.audio.load();
    this.armWatchdog(false);
    this.set({ status: "idle", position: 0, engine: null });
  }
  async load(track: Track, settings: Settings, position = 0, recovery = false) {
    this.stop();
    if (!recovery) this.recoveries = 0;
    const token = this.epoch;
    this.current = track;
    this.settings = { ...settings };
    this.wantsPlay = true;
    this.abort = new AbortController();
    const signal = AbortSignal.any([
      this.abort.signal,
      AbortSignal.timeout(25000),
    ]);
    this.set({
      status: "loading",
      trackId: track.id,
      duration: track.duration,
      position,
      message: "Pipedで音声を準備しています",
      instance: "",
    });
    if ("mediaSession" in navigator)
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title,
        artist: track.uploader,
        artwork: track.thumbnail ? [{ src: track.thumbnail }] : [],
      });
    const errors: string[] = [];
    try {
      piped.preferred = settings.instance;
      const available = piped.ranked();
      const cooling = piped.ranked(true).filter((h) => !available.includes(h));
      const candidates = [...available, ...cooling].slice(0, 18);
      for (let offset = 0; offset < candidates.length; offset += 3) {
        if (token !== this.epoch) return;
        signal.throwIfAborted();
        this.set({
          message: `Piped接続先を確認しています（${Math.min(offset + 3, candidates.length)} / ${candidates.length}）`,
        });
        const batch = candidates.slice(offset, offset + 3);
        const results = await Promise.allSettled(
          batch.map(async (h) => {
            const cached = this.prefetchCache.get(track.id);
            const info =
              cached &&
              Date.now() - cached.at < 45000 &&
              cached.instance === h.url
                ? cached.info
                : await piped.at<StreamInfo>(
                    h.url,
                    `/streams/${track.id}`,
                    signal,
                    4500,
                  );
            if (!Array.isArray(info.audioStreams))
              throw Error("音声情報の形式が不正です");
            return { h, info };
          }),
        );
        for (let i = 0; i < results.length; i++) {
          if (token !== this.epoch) return;
          signal.throwIfAborted();
          const result = results[i];
          if (result.status === "rejected") {
            errors.push(
              `${new URL(batch[i].url).hostname}: ${String(result.reason).slice(0, 180)}`,
            );
            continue;
          }
          const { h, info } = result.value;
          this.set({ duration: info.duration || track.duration });
          this.onMetadata({
            ...track,
            title: info.title || track.title,
            uploader: info.uploader || track.uploader,
            thumbnail: info.thumbnailUrl || track.thumbnail,
            duration: info.duration || track.duration,
            uploaderUrl: info.uploaderUrl,
          });
          const streams = [
            ...compatibleStreams(
              info.audioStreams,
              (s) => this.audio.canPlayType(s),
              settings.quality,
            ),
            ...compatibleStreams(
              (info.videoStreams || []).filter((s) => s.videoOnly === false),
              (s) => this.audio.canPlayType(s),
              settings.quality,
              true,
            ),
          ].slice(0, 4);
          if (!streams.length) {
            const reason = info.audioStreams.length
              ? "端末で再生できる音声形式がありません"
              : "API応答に音声ストリームが含まれていません";
            errors.push(`${new URL(h.url).hostname}: ${reason}`);
            piped.failure(h.url, reason);
            continue;
          }
          for (const stream of streams) {
            if (token !== this.epoch) return;
            signal.throwIfAborted();
            try {
              this.set({
                engine: "piped",
                instance: h.url,
                message: "Piped音声に接続しています",
              });
              await this.startAudio(stream.url, position, signal);
              if (token !== this.epoch) return;
              this.set({ status: "playing", message: "" });
              this.armWatchdog(false);
              return;
            } catch (e) {
              if (token !== this.epoch) return;
              if (e instanceof DOMException && e.name === "NotAllowedError") {
                this.set({
                  status: "blocked",
                  message: "再生ボタンを押すとPiped音声を再開します",
                });
                return;
              }
              this.audio.pause();
              errors.push(
                `${new URL(h.url).hostname}: ${e instanceof Error ? e.message : String(e)}`,
              );
            }
          }
          piped.failure(h.url, "音声ストリームを実再生できませんでした");
        }
      }
      throw Error(
        "現在のPiped接続先から、この曲の再生可能な音声を取得できません。接続先を再評価して再試行してください。",
      );
    } catch (e) {
      if (token !== this.epoch) return;
      this.wantsPlay = false;
      this.audio.pause();
      this.onFailure(track.id);
      const timedOut = signal.aborted && !this.abort.signal.aborted;
      this.set({
        status: "error",
        message: timedOut
          ? "Piped音声の取得が25秒でタイムアウトしました。接続先を再評価して再試行してください。"
          : `${e instanceof Error ? e.message : String(e)}${errors.length ? " 最終結果：" + errors.slice(-2).join(" / ") : ""}`,
      });
    }
  }
  private startAudio(url: string, position: number, signal: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const done = (error?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.audio.removeEventListener("loadedmetadata", metadata);
        this.audio.removeEventListener("error", errorEvent);
        signal.removeEventListener("abort", cancel);
        error ? reject(error) : resolve();
      };
      const metadata = () => {
        if (Number.isFinite(this.audio.duration)) {
          this.set({ duration: this.audio.duration });
          if (position > 0)
            this.audio.currentTime = Math.min(
              position,
              this.audio.duration - 0.2,
            );
        }
      };
      const errorEvent = () => done(Error("音声URLが無効か、形式が未対応です"));
      const cancel = () => done(new DOMException("Cancelled", "AbortError"));
      const timer = setTimeout(
        () => done(Error("音声の開始がタイムアウトしました")),
        5000,
      );
      this.audio.addEventListener("loadedmetadata", metadata);
      this.audio.addEventListener("error", errorEvent);
      signal.addEventListener("abort", cancel, { once: true });
      this.audio.src = url;
      this.lastProgress = position;
      this.audioConfirmed = false;
      this.stallAt = 0;
      void this.audio.play().then(() => done(), done);
    });
  }
  async play() {
    if (!this.current || !this.settings) return;
    this.wantsPlay = true;
    if (
      this.state.status === "error" ||
      this.state.status === "idle" ||
      this.state.status === "ended" ||
      !this.audio.src
    ) {
      await this.load(
        this.current,
        this.settings,
        this.state.status === "ended" ? 0 : this.state.position,
      );
      return;
    }
    try {
      await this.audio.play();
      this.armWatchdog();
    } catch {
      this.set({ status: "blocked", message: "再生ボタンを押してください" });
    }
  }
  pause() {
    if (this.state.status === "loading") {
      this.abort?.abort();
      this.epoch++;
    }
    this.wantsPlay = false;
    this.audio.pause();
    this.armWatchdog(false);
    this.set({ status: "paused" });
  }
  seek(position: number) {
    const p = Math.max(0, Math.min(position, this.state.duration));
    try {
      this.audio.currentTime = p;
      this.stallAt = 0;
      this.lastProgress = p;
      this.set({ position: p });
    } catch {
      this.set({
        message:
          "シークできませんでした。Piped音声を再取得して再試行してください。",
      });
    }
  }
  volume(value: number) {
    this.audio.volume = Math.max(0, Math.min(1, value));
  }
  async prefetch(id: string, _settings: Settings) {
    if (
      (navigator as Navigator & { connection?: { saveData: boolean } })
        .connection?.saveData
    )
      return;
    try {
      const h = piped.ranked()[0];
      if (!h) return;
      const info = await piped.at<StreamInfo>(
        h.url,
        `/streams/${id}`,
        undefined,
        3000,
      );
      if (!info.audioStreams?.length) return;
      this.prefetchCache.clear();
      this.prefetchCache.set(id, { at: Date.now(), info, instance: h.url });
    } catch {}
  }
}
export const player = new MusicPlayer();
