import type {
  AudioStream,
  InstanceHealth,
  SearchPage,
  StreamInfo,
  PipedItem,
} from "../types";
import { healthRead, healthSave } from "./storage";
import { fromItem } from "./model";
const seed = [
  "https://pipedapi.ducks.party",
  "https://api.piped.private.coffee",
  "https://pipedapi.kavin.rocks",
  "https://pipedapi.adminforge.de",
  "https://pipedapi.owo.si",
  "https://pipedapi.ducks.party",
  "https://api.piped.private.coffee",
  "https://pipedapi.nosebs.ru",
  "https://pipedapi.leptons.xyz",
  "https://pipedapi.orangenet.cc",
  "https://pipedapi.reallyaweso.me",
  "https://pipedapi.darkness.services",
  "https://piped-api.codespace.cz",
  "https://api.piped.yt",
  "https://pipedapi.drgns.space",
  "https://piped-api.privacy.com.de",
  "https://pipedapi-libre.kavin.rocks",
];
const fresh = (url: string): InstanceHealth => ({
  url,
  success: 0,
  failure: 0,
  latency: 1200,
  cooldown: 0,
  lastError: "",
  audioSuccess: 0,
  lastChecked: 0,
});
export class PipedClient {
  health: InstanceHealth[] = [...new Set(seed)].map(fresh);
  preferred = "";
  onHealth = () => {};
  private cache = new Map<string, { at: number; value: unknown }>();
  async init() {
    try {
      const h = await healthRead();
      if (Array.isArray(h))
        this.health = h.filter(
          (x) => typeof x.url === "string" && x.url.startsWith("https://"),
        );
      for (const u of seed)
        if (!this.health.some((h) => h.url === u)) this.health.push(fresh(u));
    } catch {}
    this.onHealth();
    void this.discover();
  }
  async discover() {
    try {
      const r = await fetch(
        "https://raw.githubusercontent.com/TeamPiped/documentation/main/content/docs/public-instances/index.md",
        { signal: AbortSignal.timeout(5000) },
      );
      if (!r.ok) throw Error(String(r.status));
      const text = await r.text();
      for (const line of text.split("\n")) {
        const url = line.split("|")[1]?.trim();
        if (
          url &&
          /^https:\/\/[a-z\d.-]+\/?$/i.test(url) &&
          !this.health.some((h) => h.url === url)
        )
          this.health.push(fresh(url.replace(/\/$/, "")));
      }
      this.record();
    } catch {}
  }
  add(url: string) {
    const u = new URL(url);
    if (
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      u.search ||
      u.hash
    )
      throw Error("HTTPSのAPI URLを入力してください");
    const clean = u.href.replace(/\/$/, "");
    if (!this.health.some((h) => h.url === clean))
      this.health.push(fresh(clean));
    this.record();
    return clean;
  }
  ranked(includeCooling = false) {
    return [...this.health]
      .filter((h) => includeCooling || h.cooldown < Date.now())
      .sort((a, b) => {
        const score = (h: InstanceHealth) =>
          h.latency +
          h.failure * 400 -
          h.success * 60 -
          h.audioSuccess * 400 -
          (h.url === this.preferred ? 5000 : 0);
        return score(a) - score(b);
      });
  }
  record() {
    this.onHealth();
    void healthSave(this.health).catch(() => {});
  }
  failure(url: string, e: unknown) {
    const h = this.health.find((h) => h.url === url);
    if (!h) return;
    h.failure++;
    h.lastError = e instanceof Error ? e.message : String(e);
    h.lastChecked = Date.now();
    h.cooldown =
      Date.now() + Math.min(300000, 10000 * 2 ** Math.min(h.failure, 5));
    this.record();
  }
  audioSuccess(url: string) {
    const h = this.health.find((h) => h.url === url);
    if (h) {
      h.audioSuccess++;
      h.cooldown = 0;
      this.record();
    }
  }
  async at<T>(
    url: string,
    path: string,
    signal?: AbortSignal,
    timeout = 4500,
  ): Promise<T> {
    const begin = performance.now();
    try {
      const r = await fetch(url + path, {
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(timeout)])
          : AbortSignal.timeout(timeout),
        credentials: "omit",
      });
      const body = await r.text();
      let value;
      try {
        value = JSON.parse(body);
      } catch {
        throw Error(`HTTP ${r.status}: JSONではない応答`);
      }
      if (!r.ok || value?.error) {
        const detail = String(
          value?.error || value?.message || `HTTP ${r.status}`,
        );
        throw Error(
          /SignInConfirmNotBot|LOGIN_REQUIRED|not a bot/.test(detail)
            ? `HTTP ${r.status}: 配信元がこの接続先の動画取得を拒否しました`
            : detail.slice(0, 240),
        );
      }
      if (value?.error || (value?.message && value?.exception))
        throw Error(value.error || value.message);
      const h = this.health.find((h) => h.url === url);
      if (h) {
        h.success++;
        h.latency = performance.now() - begin;
        h.cooldown = 0;
        h.lastChecked = Date.now();
        h.lastError = "";
        this.record();
      }
      return value;
    } catch (e) {
      if (!signal?.aborted) this.failure(url, e);
      throw e;
    }
  }
  async request<T>(
    path: string,
    signal?: AbortSignal,
    force = false,
  ): Promise<T> {
    const cached = this.cache.get(path);
    if (!force && cached && Date.now() - cached.at < 120000)
      return cached.value as T;
    const candidates = this.ranked();
    const list = [
      ...candidates,
      ...this.ranked(true).filter((h) => !candidates.includes(h)),
    ].slice(0, 24);
    const timeoutSignal = AbortSignal.timeout(25000);
    const effectiveSignal = signal
      ? AbortSignal.any([signal, timeoutSignal])
      : timeoutSignal;
    for (let i = 0; i < list.length; i += 3) {
      if (signal?.aborted) throw signal.reason;
      if (timeoutSignal.aborted) break;
      try {
        const value = await Promise.any(
          list
            .slice(i, i + 3)
            .map((h) => this.at<T>(h.url, path, effectiveSignal)),
        );
        this.cache.set(path, { at: Date.now(), value });
        if (this.cache.size > 150)
          this.cache.delete(this.cache.keys().next().value!);
        return value;
      } catch (e) {
        if (signal?.aborted) throw e;
        if (timeoutSignal.aborted) break;
      }
    }
    throw Error(
      "Pipedに接続できません。接続先を再評価して再試行してください。",
    );
  }
  async search(
    q: string,
    nextpage?: string,
    signal?: AbortSignal,
    filter = "videos",
  ) {
    const params = new URLSearchParams({
      q,
      filter,
      ...(nextpage ? { nextpage } : {}),
    });
    const result = await this.request<SearchPage>(
      `${nextpage ? "/nextpage/search" : "/search"}?${params}`,
      signal,
    );
    if (!Array.isArray(result.items))
      throw Error("検索応答の形式が正しくありません");
    return result;
  }
  async streams(id: string, signal?: AbortSignal) {
    const value = await this.request<StreamInfo>(`/streams/${id}`, signal);
    if (!Array.isArray(value.audioStreams))
      throw Error("音声情報の形式が正しくありません");
    return value;
  }
  async suggestions(q: string, signal?: AbortSignal) {
    const result = await this.request<unknown>(
      `/suggestions?query=${encodeURIComponent(q)}`,
      signal,
    );
    return Array.isArray(result)
      ? (result.filter((x) => typeof x === "string") as string[])
      : [];
  }
  async playlist(id: string, nextpage?: string, signal?: AbortSignal) {
    return this.request<{
      name: string;
      relatedStreams: PipedItem[];
      nextpage?: string;
    }>(
      `${nextpage ? "/nextpage/playlists/" : "/playlists/"}${encodeURIComponent(id)}${nextpage ? "?" + new URLSearchParams({ nextpage }) : ""}`,
      signal,
    );
  }
  async channel(path: string, signal?: AbortSignal) {
    if (!/^\/(channel|c|user)\/[\w@.-]+$/.test(path))
      throw Error("チャンネルURLに対応していません");
    const d = await this.request<{ relatedStreams: PipedItem[]; name: string }>(
      path,
      signal,
    );
    return d.relatedStreams.map(fromItem).filter((x) => x !== null);
  }
  async check() {
    this.health.forEach((h) => (h.cooldown = 0));
    await Promise.allSettled(
      this.health.map((h) =>
        this.at(h.url, "/search?q=music&filter=videos", undefined, 5000),
      ),
    );
  }
}
export function compatibleStreams(
  streams: AudioStream[],
  canPlay: (s: string) => string,
  quality = "balanced",
  allowMuxed = false,
) {
  return streams
    .filter(
      (s) =>
        s.url?.startsWith("https://") &&
        (s.mimeType?.startsWith("audio/") ||
          (allowMuxed && s.mimeType === "video/mp4")) &&
        canPlay(s.mimeType + (s.codec ? `; codecs="${s.codec}"` : "")),
    )
    .sort((a, b) => {
      const target =
        quality === "data" ? 64000 : quality === "high" ? 192000 : 128000;
      const score = (s: AudioStream) =>
        Math.abs((s.bitrate || 128000) - target) +
        (s.mimeType === "audio/mp4" ? -10000 : 0) +
        (s.quality?.includes("LBRY") ? 1000000 : 0);
      return score(a) - score(b);
    });
}
export const piped = new PipedClient();
