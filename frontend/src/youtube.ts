// Same official IFrame API used by Curiveo. No private playback server or key.
export interface YouTubeController {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(time: number, allowSeekAhead: boolean): void;
  setVolume(volume: number): void;
  getCurrentTime(): number;
  getDuration(): number;
  destroy(): void;
}
interface YouTubeApi {
  Player: new (
    target: HTMLIFrameElement,
    options: {
      events: {
        onReady(event: { target: YouTubeController }): void;
        onStateChange(event: { data: number }): void;
        onError(event: { data: number }): void;
        onAutoplayBlocked(): void;
      };
    },
  ) => YouTubeController;
}
declare global {
  interface Window {
    YT?: YouTubeApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}
let pending: Promise<YouTubeApi> | undefined;
export function loadYouTubeApi(): Promise<YouTubeApi> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (pending) return pending;
  pending = new Promise((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    const script = document.createElement("script");
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      window.onYouTubeIframeAPIReady = previous;
      if (error || !window.YT?.Player) {
        pending = undefined;
        script.remove();
        reject(error || new Error("YouTubeプレーヤーを読み込めませんでした"));
      } else resolve(window.YT);
    };
    const timeout = setTimeout(
      () =>
        finish(
          new Error(
            "YouTubeへの接続がタイムアウトしました。再試行してください",
          ),
        ),
      15000,
    );
    window.onYouTubeIframeAPIReady = () => {
      try {
        previous?.();
      } finally {
        finish();
      }
    };
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () =>
      finish(
        new Error("YouTubeに接続できません。通信を確認して再試行してください"),
      );
    document.head.append(script);
  });
  return pending;
}
export function youtubeError(code: number) {
  if (code === 101 || code === 150)
    return "この動画は埋め込み再生が許可されていません。別の候補を選ぶか、YouTubeで開いてください";
  if (code === 153)
    return "YouTubeが再生元を確認できませんでした。再試行するか、YouTubeで開いてください";
  if (code === 100)
    return "この動画は削除済み・非公開などの理由で再生できません";
  return `YouTubeで再生できませんでした (${code})。再試行するか、別の候補を選んでください`;
}
