import type { AudioStream, Settings, StreamInfo } from "../types";
import { invidious, compatibleStreams } from "./invidious";
import { PlaybackError, classify, reliability } from "./reliability";
export interface PreparedAudio {
  id: string;
  instance: string;
  info: StreamInfo;
  stream: AudioStream;
  at: number;
  checked: "decoded";
  buffer?: HTMLAudioElement;
}
export async function probeMedia(
  stream: AudioStream,
  signal: AbortSignal,
): Promise<HTMLAudioElement> {
  const audio = new Audio();
  audio.muted = true;
  audio.preload = "auto";
  let readyToKeep = false;
  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const done = (error?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        audio.removeEventListener("loadeddata", ready);
        audio.removeEventListener("error", failed);
        signal.removeEventListener("abort", cancel);
        error ? reject(error) : resolve();
      };
      const ready = () => done();
      const failed = () =>
        done(
          new PlaybackError(
            audio.error?.code === 3 ? "unsupported_format" : "network_or_cors",
            `音声の読み込みに失敗しました（MediaError ${audio.error?.code || 0}）`,
            "probe",
          ),
        );
      const cancel = () =>
        done(signal.reason || new DOMException("Cancelled", "AbortError"));
      const timer = setTimeout(
        () =>
          done(
            new PlaybackError(
              "timeout",
              "音声の先行読み込みがタイムアウトしました",
              "probe",
            ),
          ),
        4500,
      );
      audio.addEventListener("loadeddata", ready);
      audio.addEventListener("error", failed);
      signal.addEventListener("abort", cancel, { once: true });
      if (signal.aborted) {
        cancel();
        return;
      }
      audio.src = stream.url;
      audio.load();
      if (audio.readyState >= 2) ready();
    });
    readyToKeep = true;
    audio.preload = "metadata";
    return audio;
  } finally {
    audio.pause();
    if (!readyToKeep) { audio.removeAttribute("src"); audio.load(); }
  }
}
export function withAbort<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const abort = () =>
      reject(signal.reason || new DOMException("Cancelled", "AbortError"));
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (v) => {
        signal.removeEventListener("abort", abort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener("abort", abort);
        reject(e);
      },
    );
  });
}
export class StreamResolver {
  private cache = new Map<string, PreparedAudio>();
  private pending = new Map<string, { job: Promise<PreparedAudio>; control: AbortController; users: number }>();
  private badURLs = new Map<string, Map<string, number>>();
  constructor(
    private canPlay: (type: string) => string,
    private probe: (stream: AudioStream, signal: AbortSignal) => Promise<HTMLAudioElement | void> = probeMedia,
  ) {}
  private release(item: PreparedAudio) {
    if (item.buffer) { item.buffer.pause(); item.buffer.removeAttribute("src"); item.buffer.load(); item.buffer = undefined; }
  }
  private key(id: string, s: Settings) {
    return `${id}:${s.quality}:${s.instance}`;
  }
  invalidate(id: string, url?: string) {
    for (const [k, v] of this.cache) if (v.id === id) { this.release(v); this.cache.delete(k); }
    if (url) {
      const bad = this.badURLs.get(id) || new Map<string, number>();
      bad.set(url, Date.now() + 60000);
      this.badURLs.set(id, bad);
    }
  }
  cached(id: string, settings: Settings) {
    const item = this.cache.get(this.key(id, settings));
    if (!item) return;
    if (Date.now() - item.at > 300000) { this.release(item); this.cache.delete(this.key(id, settings)); return; }
    try {
      const expires = Number(
        new URL(item.stream.url).searchParams.get("expire"),
      );
      if (expires && expires * 1000 < Date.now() + 15000) { this.release(item); this.cache.delete(this.key(id, settings)); return; }
    } catch {
      return;
    }
    return item;
  }
  async prepare(id: string, settings: Settings, signal?: AbortSignal) {
    const ready = this.cached(id, settings);
    if (ready) return ready;
    const key = this.key(id, settings);
    let entry = this.pending.get(key);
    if (!entry || entry.control.signal.aborted) {
      const control = new AbortController();
      entry = { control, users: 0, job: undefined! };
      const owned = entry;
      entry.job = this.resolve(id, settings, control).finally(() => {
        if (this.pending.get(key) === owned) this.pending.delete(key);
      });
      this.pending.set(key, entry);
    }
    entry.users++;
    try { return await withAbort(entry.job, signal); }
    finally { if (--entry.users === 0) entry.control.abort(); }
  }
  private async resolve(
    id: string,
    settings: Settings,
    control: AbortController,
  ): Promise<PreparedAudio> {
    const signal = AbortSignal.any([
      control.signal,
      AbortSignal.timeout(20000),
    ]);
    invidious.preferred = settings.instance;
    const ordinary = invidious.ranked(false, "audio");
    const candidates = (
      ordinary.length ? ordinary : invidious.ranked(true, "audio").slice(0, 3)
    ).slice(0, 18);
    const errors: PlaybackError[] = [];
    let metadataCount = 0;
    try {
      for (let offset = 0; offset < candidates.length; offset += 3) {
        signal.throwIfAborted();
        const jobs = candidates.slice(offset, offset + 3).map((h, index) => ({
          index,
          job: invidious.at<StreamInfo>(h.url, `/api/v1/videos/${id}`, signal, 4000).then(
            (info) => ({ index, h, info, error: undefined }),
            (error) => ({
              index,
              h,
              info: undefined,
              error: classify(error, "streams", h.url),
            }),
          ),
        }));
        while (jobs.length) {
          const result = await Promise.race(jobs.map((x) => x.job));
          jobs.splice(
            jobs.findIndex((x) => x.index === result.index),
            1,
          );
          signal.throwIfAborted();
          const { h, info } = result;
          if (result.error) {
            errors.push(result.error);
            invidious.audioResult(h.url, "failure", result.error);
            continue;
          }
          if (!info || !Array.isArray(info.audioStreams)) {
            const error = new PlaybackError(
              "invalid_response",
              "音声情報の形式が不正です",
              "streams",
              h.url,
            );
            errors.push(error);
            invidious.audioResult(h.url, "failure", error);
            continue;
          }
          metadataCount++;
          const streamsFrom = (source: StreamInfo) => [
            ...compatibleStreams(source.audioStreams, this.canPlay, settings.quality),
            ...compatibleStreams(
              (source.videoStreams || []).filter((s) => s.videoOnly === false),
              this.canPlay, settings.quality, true,
            ),
          ];
          const direct = streamsFrom(info);
          const tried = new Set<string>();
          const attempt = async (stream: AudioStream, route: "direct" | "proxy" = "direct"): Promise<PreparedAudio | undefined> => {
            if (tried.has(stream.url) ||
              (this.badURLs.get(id)?.get(stream.url) || 0) >= Date.now()) return;
            tried.add(stream.url);
            try {
              signal.throwIfAborted();
              const buffer = await this.probe(stream, signal);
              signal.throwIfAborted();
              const prepared: PreparedAudio = {
                id, instance: h.url, info, stream, at: Date.now(), checked: "decoded", buffer: buffer || undefined,
              };
              this.cache.set(this.key(id, settings), prepared);
              if (this.cache.size > 3) {
                const oldest = this.cache.keys().next().value!;
                this.release(this.cache.get(oldest)!); this.cache.delete(oldest);
              }
              h.mediaRoute = route;
              invidious.audioResult(h.url, "prepared");
              reliability.record({
                trackId: id, instance: h.url, stage: "probe", outcome: "success",
                host: new URL(stream.url).hostname,
                detail: stream.url.startsWith(h.url + "/")
                  ? "Invidious経由の音声をデコード確認（実再生前）"
                  : "直接配信の音声をデコード確認（実再生前）",
              });
              return prepared;
            } catch (e) {
              if (signal.aborted) throw e;
              this.invalidate(id, stream.url);
              let error = classify(e, "probe", h.url);
              // A readable HTTP response is stronger evidence than MediaError 4.
              // Limit diagnostic latency so recovery isn't delayed.
              if (error.kind === "network_or_cors") {
                try {
                  const response = await fetch(stream.url, {
                    headers: { Range: "bytes=0-1023" },
                    signal: AbortSignal.any([signal, AbortSignal.timeout(500)]),
                  });
                  await response.body?.cancel();
                  if (!response.ok) error = new PlaybackError(
                    "media_http", "音声URLがHTTP " + response.status + "を返しました",
                    "probe", h.url, response.status,
                  );
                } catch {
                  // CORS and network failures remain indistinguishable.
                }
              }
              errors.push(error);
              invidious.audioResult(h.url, "failure", error);
              reliability.record({
                trackId: id, instance: h.url, stage: "probe",
                outcome: "failure", kind: error.kind, status: error.status,
                host: new URL(stream.url).hostname, detail: error.message,
              });
            }
          };

          if (!direct.length) {
            const present = info.audioStreams.length +
              (info.videoStreams?.filter((s) => !s.videoOnly).length || 0);
            const error = new PlaybackError(
              present ? "unsupported_format" : "no_stream",
              present ? "この端末に対応した音声形式がありません"
                : "API応答に音声を含む配信URLがありません",
              "streams", h.url,
            );
            errors.push(error);
            invidious.audioResult(h.url, "failure", error);
            continue;
          }

          const tryProxy = async (): Promise<PreparedAudio | undefined> => {
          let proxyInfo: StreamInfo | undefined;
          try {
            proxyInfo = await invidious.at<StreamInfo>(
              h.url, "/api/v1/videos/" + id + "?local=true", signal, 4000,
            );
          } catch (e) {
            if (signal.aborted) throw e;
            const error = classify(e, "streams", h.url);
            errors.push(error);
            reliability.record({
              trackId: id, instance: h.url, stage: "streams",
              outcome: "failure", kind: error.kind, status: error.status,
              detail: "Invidious音声プロキシ取得失敗: " + error.message,
            });
          }
          if (proxyInfo) {
            const localStreams = streamsFrom(proxyInfo)
              .filter((s) => !direct.some((original) => original.url === s.url))
              .slice(0, 2);
            for (const stream of localStreams) {
              const playable = await attempt(stream, "proxy");
              if (playable) return playable;
            }
          }

          // Alternative local proxy endpoint for servers that support it.
          const preferredItags = direct.filter((s) => s.itag).slice(0, 1);
          for (const source of preferredItags) {
            const u = new URL("/latest_version", h.url);
            u.searchParams.set("id", id);
            u.searchParams.set("itag", source.itag!);
            u.searchParams.set("local", "true");
            const playable = await attempt({ ...source, url: u.href }, "proxy");
            if (playable) return playable;
          }

            return undefined;
          };
          const prefersProxy = h.mediaRoute === "proxy";
          if (prefersProxy) { const local = await tryProxy(); if (local) return local; }
          const first = await attempt(direct[0]);
          if (first) return first;
          if (!prefersProxy) { const local = await tryProxy(); if (local) return local; }

          // A proxy can be unavailable; still try other direct codecs.
          for (const stream of direct.slice(1, 3)) {
            const playable = await attempt(stream);
            if (playable) return playable;
          }
        }
      }
    } catch (e) {
      const error = classify(e, "streams");
      if (error.kind !== "cancelled") errors.push(error);
    } finally {
      control.abort();
    }
    const specific =
      errors.find((e) => e.kind === "upstream_rejected") ||
      errors.find((e) =>
        ["media_http", "unsupported_format", "no_stream"].includes(e.kind),
      );
    if (specific) throw specific;
    if (!metadataCount)
      throw new PlaybackError(
        "api_unavailable",
        `利用候補${candidates.length}接続先から再生用情報を取得できません。全体障害の可能性があるためキューを保持します。`,
        "streams",
      );
    throw (
      errors.at(-1) ||
      new PlaybackError("no_stream", "再生可能な音声がありません", "streams")
    );
  }
}
