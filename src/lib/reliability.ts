import { runtimeRead, runtimeSave } from "./storage";
export type FailureKind =
  | "api_unavailable"
  | "upstream_rejected"
  | "media_http"
  | "unsupported_format"
  | "autoplay_blocked"
  | "network_or_cors"
  | "timeout"
  | "invalid_response"
  | "no_stream"
  | "internal"
  | "cancelled";
export type Stage = "api" | "streams" | "probe" | "play" | "queue";
export interface Diagnostic {
  at: number;
  trackId?: string;
  instance: string;
  stage: Stage;
  outcome: "success" | "failure" | "skip";
  kind?: FailureKind;
  status?: number;
  detail: string;
  host?: string;
}
export class PlaybackError extends Error {
  constructor(
    public kind: FailureKind,
    message: string,
    public stage: Stage = "streams",
    public instance = "",
    public status?: number,
  ) {
    super(message);
    this.name = "PlaybackError";
  }
}
export function classify(
  error: unknown,
  stage: Stage = "streams",
  instance = "",
): PlaybackError {
  if (error instanceof PlaybackError)
    return new PlaybackError(
      error.kind,
      error.message,
      error.stage,
      error.instance || instance,
      error.status,
    );
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);
  if (name === "NotAllowedError")
    return new PlaybackError(
      "autoplay_blocked",
      "ブラウザの再生操作が必要です",
      stage,
      instance,
    );
  if (name === "TimeoutError" || /timeout|タイムアウト/i.test(message))
    return new PlaybackError(
      "timeout",
      "接続がタイムアウトしました",
      stage,
      instance,
    );
  if (name === "AbortError")
    return new PlaybackError(
      "cancelled",
      "操作を中断しました",
      stage,
      instance,
    );
  if (/LOGIN_REQUIRED|SignInConfirmNotBot|not a bot|取得を拒否/.test(message))
    return new PlaybackError(
      "upstream_rejected",
      "配信元がこの接続先の動画取得を拒否しました",
      stage,
      instance,
    );
  if (name === "TypeError" || /Failed to fetch|NetworkError/i.test(message))
    return new PlaybackError(
      "network_or_cors",
      "ネットワークまたはCORSのため接続できません（ブラウザからは区別不能）",
      stage,
      instance,
    );
  return new PlaybackError("internal", message.slice(0, 200), stage, instance);
}
interface Exclusion {
  until: number;
  failures: number;
  kind: FailureKind;
  detail: string;
}
export class Reliability {
  events: Diagnostic[] = [];
  excluded: Record<string, Exclusion> = {};
  onChange = () => {};
  private timer?: ReturnType<typeof setTimeout>;
  async init() {
    try {
      const value = await runtimeRead("reliability");
      if (value) {
        this.events = Array.isArray(value.events)
          ? value.events.slice(-240)
          : [];
        this.excluded =
          value.excluded && typeof value.excluded === "object"
            ? value.excluded
            : {};
      }
    } catch {}
    this.onChange();
  }
  record(event: Omit<Diagnostic, "at">) {
    this.events.push({
      ...event,
      at: Date.now(),
      detail: event.detail.replace(/https?:\/\/\S+/g, "[URL]").slice(0, 260),
    });
    this.events = this.events.slice(-240);
    this.onChange();
    clearTimeout(this.timer);
    this.timer = setTimeout(
      () =>
        void runtimeSave("reliability", {
          events: this.events,
          excluded: this.excluded,
        }).catch(() => {}),
      100,
    );
  }
  isExcluded(id: string) {
    return !!this.excluded[id] && this.excluded[id].until > Date.now();
  }
  block(id: string, error: PlaybackError) {
    if (
      ["cancelled", "autoplay_blocked", "api_unavailable", "internal"].includes(
        error.kind,
      )
    )
      return;
    const prior = this.excluded[id];
    const failures = (prior?.failures || 0) + 1;
    const ttl = [
      "upstream_rejected",
      "no_stream",
      "unsupported_format",
      "media_http",
    ].includes(error.kind)
      ? Math.min(30 * 60000, 5 * 60000 * failures)
      : 60000;
    this.excluded[id] = {
      until: Date.now() + ttl,
      failures,
      kind: error.kind,
      detail: error.message,
    };
    this.record({
      trackId: id,
      instance: error.instance,
      stage: error.stage,
      outcome: "skip",
      kind: error.kind,
      detail: `一時除外 ${Math.round(ttl / 60000)}分: ${error.message}`,
    });
  }
  success(id: string, instance: string) {
    delete this.excluded[id];
    this.record({
      trackId: id,
      instance,
      stage: "play",
      outcome: "success",
      detail: "音声の再生位置の進行を確認",
    });
  }
  clear(id?: string) {
    if (id) delete this.excluded[id];
    else this.excluded = {};
    this.onChange();
    void runtimeSave("reliability", {
      events: this.events,
      excluded: this.excluded,
    }).catch(() => {});
  }
}
export const reliability = new Reliability();
