import { invidious } from "./invidious";
import type { Settings, Track } from "../types";
import { classify, PlaybackError, reliability } from "./reliability";
import { StreamResolver, type PreparedAudio } from "./streams";
import { savedAudio } from "./local-audio";
export type PlaybackStatus =
  "idle" | "loading" | "playing" | "paused" | "blocked" | "error" | "ended";
export interface PlaybackState {
  status: PlaybackStatus;
  engine: "invidious" | "local" | null;
  position: number;
  duration: number;
  message: string;
  trackId: string;
  instance: string;
}
export type LoadResult =
  | { status: "playing" }
  | { status: "blocked" }
  | { status: "cancelled" }
  | { status: "failed"; error: PlaybackError };
export class MusicPlayer {
  audio = new Audio();
  resolver: StreamResolver;
  state: PlaybackState = {
    status: "idle",
    engine: null,
    position: 0,
    duration: 0,
    message: "",
    trackId: "",
    instance: "",
  };
  onState = (_s: PlaybackState) => {};
  onEnded = () => {};
  onMetadata = (_track: Track) => {};
  onFailure = (_id: string, _error?: PlaybackError) => {};
  onListen = (_seconds: number) => {};
  onIntent = (_kind: "stop" | "pause") => {};
  onTerminalFailure = (_id: string) => {};
  private epoch = 0;
  private abort?: AbortController;
  private endedEpoch = -1;
  private wantsPlay = false;
  private recovering = false;
  private recoveries = 0;
  private current?: Track;
  private settings?: Settings;
  private watchdog?: ReturnType<typeof setTimeout>;
  private lastTick = 0;
  private lastProgress = 0;
  private audioConfirmed = false;
  private stallAt = 0;
  private expectedSrc = "";
  private started = false;
  private objectURL = "";
  private handlers: Array<[string, EventListener]> = [];
  private loadStarted = 0;
  private usedPrefetch = false;
  metrics: Array<{ id: string; source: string; startMs: number; prefetched: boolean; at: number }> = [];
  private listen(name: string, handler: EventListener) {
    this.handlers.push([name, handler]); this.audio.addEventListener(name, handler);
  }
  private adopt(audio: HTMLAudioElement) {
    const volume = this.audio.volume;
    for (const [name, handler] of this.handlers) this.audio.removeEventListener(name, handler);
    this.audio.pause(); this.audio.removeAttribute("src"); this.audio.load();
    this.audio = audio; this.audio.muted = false; this.audio.volume = volume;
    for (const [name, handler] of this.handlers) this.audio.addEventListener(name, handler);
  }
  constructor(resolver?: StreamResolver) {
    this.resolver =
      resolver || new StreamResolver((type) => this.audio.canPlayType(type));
    this.audio.preload = "auto";
    this.audio.volume = 0.8;
    setInterval(() => this.tick(), 500);
    document.addEventListener("visibilitychange", () => this.tick());
    this.listen("playing", () => {
      if (!this.activeSource() || !this.wantsPlay) {
        this.audio.pause();
        return;
      }
      this.started = true;
      this.set({ status: "playing", message: "" });
      this.stallAt = 0;
      this.armWatchdog(false);
    });
    this.listen("ended", () => {
      if (
        this.activeSource() &&
        this.started &&
        this.wantsPlay &&
        this.endedEpoch !== this.epoch
      ) {
        this.endedEpoch = this.epoch;
        this.wantsPlay = false;
        this.armWatchdog(false);
        this.set({ status: "ended" });
        this.onEnded();
      }
    });
    this.listen("waiting", () => {
      if (this.started) this.armWatchdog();
    });
    this.listen("error", () => {
      if (this.activeSource() && this.state.status === "playing")
        void this.recover();
    });
  }
  private activeSource() {
    return (
      !!this.state.engine &&
      !!this.expectedSrc &&
      (this.audio.currentSrc || this.audio.src) === this.expectedSrc
    );
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
            position: Math.min(this.state.duration, this.state.position),
            playbackRate: 1,
          });
      } catch {}
    }
  }
  private tick() {
    if (!this.activeSource()) return;
    const now = Date.now(),
      position = this.audio.currentTime || 0;
    if (
      this.state.status === "playing" &&
      !this.audio.paused &&
      !this.audio.seeking
    ) {
      const advanced = position > this.lastProgress + 0.02;
      if (advanced) {
        if (this.lastTick)
          this.onListen(Math.min(2, (now - this.lastTick) / 1000));
        this.stallAt = 0;
        if (!this.audioConfirmed) {
          this.audioConfirmed = true;
          if (this.state.engine === "invidious") {
            invidious.audioSuccess(this.state.instance);
            reliability.success(this.state.trackId, this.state.instance);
          }
          this.metrics.push({ id: this.state.trackId, source: this.state.engine!, startMs: Math.round(performance.now() - this.loadStarted), prefetched: this.usedPrefetch, at: Date.now() });
          this.metrics = this.metrics.slice(-100);
        }
      } else if (this.stallAt && now - this.stallAt > 12000)
        void this.recover();
      else if (!this.stallAt) this.stallAt = now;
      this.lastTick = now;
    } else this.lastTick = 0;
    this.lastProgress = position;
    this.set({
      position,
      duration: Number.isFinite(this.audio.duration)
        ? this.audio.duration
        : this.state.duration,
    });
  }
  private armWatchdog(active = true) {
    clearTimeout(this.watchdog);
    if (active && this.wantsPlay)
      this.watchdog = setTimeout(() => void this.recover(), 12000);
  }
  private async recover() {
    if (this.recovering || !this.current || !this.settings || !this.wantsPlay)
      return;
    this.recovering = true;
    const id = this.current.id;
    const error = new PlaybackError(
      "timeout",
      "再生中の音声が停止しました",
      "play",
      this.state.instance,
    );
    invidious.audioResult(this.state.instance, "failure", error);
    reliability.record({
      trackId: id,
      instance: this.state.instance,
      stage: "play",
      outcome: "failure",
      kind: error.kind,
      detail: error.message,
    });
    this.resolver.invalidate(id, this.expectedSrc);
    try {
      if (++this.recoveries > 2) {
        this.failed(this.current, error);
        this.onTerminalFailure(id);
        return;
      }
      const result = await this.load(
        this.current,
        this.settings,
        this.state.position,
        true,
      );
      if (result.status === "failed" && this.state.trackId === id)
        this.onTerminalFailure(id);
    } finally {
      this.recovering = false;
    }
  }
  stop(intent = true) {
    if (intent) this.onIntent("stop");
    this.epoch++;
    this.abort?.abort();
    this.wantsPlay = false;
    this.started = false;
    this.expectedSrc = "";
    this.audio.pause();
    this.audio.removeAttribute("src");
    this.audio.load();
    if (this.objectURL) { URL.revokeObjectURL(this.objectURL); this.objectURL = ""; }
    this.armWatchdog(false);
    this.set({ status: "idle", position: 0, engine: null });
  }
  unavailable(track: Track, message: string) {
    this.stop(false);
    this.current = track;
    this.set({
      status: "error",
      trackId: track.id,
      duration: track.duration,
      message,
      instance: "",
    });
  }
  private failed(track: Track, error: PlaybackError): LoadResult {
    this.wantsPlay = false;
    this.audio.pause();
    this.armWatchdog(false);
    this.resolver.invalidate(track.id);
    if (navigator.onLine !== false || track.source === "local") reliability.block(track.id, error);
    reliability.record({
      trackId: track.id,
      instance: error.instance || this.state.instance,
      stage: error.stage,
      outcome: "failure",
      kind: error.kind,
      status: error.status,
      detail: error.message,
    });
    this.set({ status: "error", message: error.message });
    this.onFailure(track.id, error);
    return { status: "failed", error };
  }
  async load(
    track: Track,
    settings: Settings,
    position = 0,
    recovery = false,
  ): Promise<LoadResult> {
    this.stop(false);
    this.loadStarted = performance.now();
    this.usedPrefetch = track.source !== "local" && !!this.resolver.cached(track.id, settings);
    if (!recovery) this.recoveries = 0;
    const token = this.epoch;
    this.current = track;
    this.settings = { ...settings };
    this.wantsPlay = true;
    this.abort = new AbortController();
    const signal = AbortSignal.any([
      this.abort.signal,
      AbortSignal.timeout(28000),
    ]);
    this.set({
      status: "loading",
      trackId: track.id,
      duration: track.duration,
      position,
      message: track.source === "local" ? "保存した音声を開いています" : "Invidiousの音声を確認しています",
      instance: "",
    });
    if ("mediaSession" in navigator)
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title,
        artist: track.uploader,
        artwork: track.thumbnail ? [{ src: track.thumbnail }] : [],
      });
    try {
      if (track.source === "local") {
        const blob = await savedAudio(track.id);
        if (token !== this.epoch) return { status: "cancelled" };
        if (!blob) throw new PlaybackError("no_stream", "保存音源が見つかりません。元のファイルをもう一度取り込んでください。", "play");
        this.objectURL = URL.createObjectURL(blob);
        this.set({ engine: "local", instance: "" });
        try {
          await this.startAudio({ instance: "", stream: { url: this.objectURL, mimeType: blob.type, bitrate: 0 } }, position, signal);
        } catch (e) {
          if (token !== this.epoch) return { status: "cancelled" };
          if (classify(e).kind === "autoplay_blocked") {
            this.set({ status: "blocked", message: "再生ボタンを押してください" }); return { status: "blocked" };
          }
          throw e;
        }
        if (token !== this.epoch) return { status: "cancelled" };
        this.set({ status: "playing", message: "" }); return { status: "playing" };
      }
      if (navigator.onLine === false) throw new PlaybackError("no_stream", "オンライン曲はオフラインで再生できません。保存済み音源へ進みます。", "play");
      for (let round = 0; round < 2; round++) {
        const prepared = await this.resolver.prepare(
          track.id,
          settings,
          signal,
        );
        if (token !== this.epoch) return { status: "cancelled" };
        this.onMetadata({
          ...track,
          title: prepared.info.title || track.title,
          uploader: prepared.info.uploader || track.uploader,
          thumbnail: prepared.info.thumbnailUrl || track.thumbnail,
          duration: prepared.info.duration || track.duration,
          uploaderUrl: prepared.info.uploaderUrl,
        });
        this.set({
          engine: "invidious",
          instance: prepared.instance,
          duration: prepared.info.duration || track.duration,
          message: "確認済みのInvidious音声を開始しています",
        });
        try {
          await this.startAudio(prepared, position, signal);
          if (token !== this.epoch) return { status: "cancelled" };
          this.set({ status: "playing", message: "" });
          return { status: "playing" };
        } catch (e) {
          if (token !== this.epoch) return { status: "cancelled" };
          const error = classify(e, "play", prepared.instance);
          if (error.kind === "autoplay_blocked") {
            this.set({
              status: "blocked",
              message:
                "再生ボタンを押して再開してください（ブラウザが再生を保留しました）",
            });
            reliability.record({
              trackId: track.id,
              instance: prepared.instance,
              stage: "play",
              outcome: "failure",
              kind: error.kind,
              detail: error.message,
            });
            return { status: "blocked" };
          }
          this.audio.pause();
          this.started = false;
          this.set({
            status: "loading",
            message: "別のInvidious音声で再試行しています",
          });
          this.resolver.invalidate(track.id, prepared.stream.url);
          invidious.audioResult(prepared.instance, "failure", error);
          reliability.record({
            trackId: track.id,
            instance: prepared.instance,
            stage: "play",
            outcome: "failure",
            kind: error.kind,
            detail: error.message,
          });
          if (round === 1) throw error;
        }
      }
      throw new PlaybackError(
        "internal",
        "再生状態を確定できませんでした",
        "play",
      );
    } catch (e) {
      if (token !== this.epoch) return { status: "cancelled" };
      const error = classify(e, "play", this.state.instance);
      return this.failed(track, error);
    }
  }
  private startAudio(
    prepared: Pick<PreparedAudio, "instance" | "stream" | "buffer">,
    position: number,
    signal: AbortSignal,
  ) {
    if (prepared.buffer) { this.adopt(prepared.buffer); prepared.buffer = undefined; }
    const audio = this.audio;
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const done = (error?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearInterval(progressTimer);
        audio.removeEventListener("timeupdate", progressed);
        audio.removeEventListener("loadedmetadata", metadata);
        audio.removeEventListener("error", failure);
        signal.removeEventListener("abort", cancel);
        error ? reject(error) : resolve();
      };
      let baseline = position;
      const progressed = () => {
        if (!audio.paused && !audio.seeking && audio.currentTime > baseline + 0.02) done();
      };
      const progressTimer = setInterval(progressed, 50);
      const metadata = () => {
        if (Number.isFinite(audio.duration)) {
          this.set({ duration: audio.duration });
          if (position > 0)
            audio.currentTime = Math.min(
              position,
              Math.max(0, audio.duration - 0.2),
            );
          baseline = audio.currentTime;
        }
      };
      const failure = () =>
        done(
          new PlaybackError(
            audio.error?.code === 3
              ? "unsupported_format"
              : "network_or_cors",
            `音声再生に失敗しました（MediaError ${audio.error?.code || 0}）`,
            "play",
            prepared.instance,
          ),
        );
      const cancel = () => done(signal.reason);
      const timer = setTimeout(
        () =>
          done(
            new PlaybackError(
              "timeout",
              "実音声の開始がタイムアウトしました",
              "play",
              prepared.instance,
            ),
          ),
        6000,
      );
      audio.addEventListener("timeupdate", progressed);
      audio.addEventListener("loadedmetadata", metadata);
      audio.addEventListener("error", failure);
      signal.addEventListener("abort", cancel, { once: true });
      if (signal.aborted) {
        cancel();
        return;
      }
      this.expectedSrc = prepared.stream.url;
      this.lastProgress = position;
      this.lastTick = 0;
      this.audioConfirmed = false;
      this.stallAt = 0;
      this.started = false;
      if (audio.src !== prepared.stream.url) audio.src = prepared.stream.url;
      if (audio.readyState >= 1) metadata();
      void audio.play().then(progressed, done);
    });
  }
  async play(): Promise<LoadResult> {
    if (!this.current || !this.settings) return { status: "cancelled" };
    if (
      ["error", "idle", "ended"].includes(this.state.status) ||
      !this.audio.src
    )
      return this.load(
        this.current,
        this.settings,
        this.state.status === "ended" ? 0 : this.state.position,
      );
    this.wantsPlay = true;
    const token = this.epoch;
    try {
      await this.audio.play();
      if (token !== this.epoch) return { status: "cancelled" };
      this.set({ status: "playing", message: "" });
      return { status: "playing" };
    } catch (e) {
      if (token !== this.epoch) return { status: "cancelled" };
      const error = classify(e, "play", this.state.instance);
      if (error.kind === "autoplay_blocked") {
        this.set({ status: "blocked", message: "再生ボタンを押してください" });
        return { status: "blocked" };
      }
      const result = this.failed(this.current, error);
      this.onTerminalFailure(this.current.id);
      return result;
    }
  }
  pause() {
    this.onIntent("pause");
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
    try {
      const p = Math.max(0, Math.min(position, this.state.duration));
      this.audio.currentTime = p;
      this.lastProgress = p;
      this.lastTick = 0;
      this.stallAt = 0;
      this.set({ position: p });
    } catch (e) {
      const error = classify(e, "play", this.state.instance);
      reliability.record({
        trackId: this.state.trackId,
        instance: this.state.instance,
        stage: "play",
        outcome: "failure",
        kind: error.kind,
        detail: "シークに失敗しました",
      });
      this.set({ message: "シークできませんでした。再試行してください。" });
    }
  }
  volume(value: number) {
    this.audio.volume = Math.max(0, Math.min(1, value));
  }
  async prefetch(
    id: string,
    settings: Settings,
    signal?: AbortSignal,
    required = false,
  ): Promise<PreparedAudio | undefined> {
    if (
      !required &&
      (navigator as Navigator & { connection?: { saveData: boolean } })
        .connection?.saveData
    )
      return;
    try {
      return await this.resolver.prepare(id, settings, signal);
    } catch (e) {
      const error = classify(e);
      if (!signal?.aborted) reliability.block(id, error);
      return;
    }
  }
}
export const player = new MusicPlayer();
