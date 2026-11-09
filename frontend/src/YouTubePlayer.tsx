import { useEffect, useRef } from "react";
import {
  ExternalLink,
  Maximize2,
  Minimize2,
  X,
  SkipBack,
  SkipForward,
  Play,
  Pause,
  Volume2,
} from "lucide-react";
import {
  usePlayback,
  connectYouTube,
  youtubeState,
  youtubeProgress,
  youtubeBlocked,
  youtubeFailure,
  clearPlayback,
  togglePlayback,
  previous,
  next,
  seek,
} from "./player";
import { useStore } from "./store";
import { loadYouTubeApi, youtubeError } from "./youtube";
import type { YouTubeController } from "./youtube";
import type { Track } from "./types";

export default function YouTubePlayer({
  track,
  expanded,
  onExpand,
}: {
  track?: Track;
  expanded: boolean;
  onExpand: (value: boolean) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const { videoId, requestId, status, notice, error, ready, time, duration } =
    usePlayback();
  const volume = useStore((s) => s.settings.volume);
  const titleRef = useRef(track?.title || "YouTube");
  titleRef.current = track?.title || "YouTube";
  const title = track?.title || "YouTube";
  useEffect(() => {
    let disposed = false;
    let ready = false;
    let player: YouTubeController | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let waitingSince = 0;
    const fail = (message: string) => {
      if (disposed) return;
      clearTimeout(deadline);
      clearInterval(timer);
      youtubeFailure(requestId, message);
    };
    void loadYouTubeApi()
      .then((api) => {
        if (disposed || !host.current) return;
        const iframe = document.createElement("iframe");
        iframe.title = "YouTube: " + titleRef.current;
        iframe.referrerPolicy = "strict-origin-when-cross-origin";
        iframe.allow =
          "autoplay; encrypted-media; picture-in-picture; fullscreen; accelerometer; gyroscope; web-share";
        iframe.allowFullscreen = true;
        const params = new URLSearchParams({
          enablejsapi: "1",
          playsinline: "1",
          controls: "1",
          autoplay: "0",
          start: String(Math.floor(useStore.getState().position)),
          origin: location.origin,
          rel: "0",
          hl: "ja",
        });
        iframe.src = `https://www.youtube.com/embed/${videoId}?${params}`;
        host.current.replaceChildren(iframe);
        deadline = setTimeout(
          () =>
            fail(
              "YouTubeプレーヤーに接続できませんでした。再試行するか、YouTubeで開いてください",
            ),
          20000,
        );
        player = new api.Player(iframe, {
          events: {
            onReady: ({ target }) => {
              if (disposed) return;
              player = target;
              ready = true;
              clearTimeout(deadline);
              if (
                !connectYouTube(requestId, target) ||
                usePlayback.getState().status === "error"
              )
                return;
              timer = setInterval(() => {
                const state = usePlayback.getState();
                if (
                  disposed ||
                  !ready ||
                  !player ||
                  state.requestId !== requestId
                )
                  return;
                if (state.status === "loading") {
                  waitingSince ||= Date.now();
                  if (Date.now() - waitingSince >= 30000) {
                    fail(
                      "YouTubeの再生が始まりませんでした。再試行するか、YouTubeで開いてください",
                    );
                    return;
                  }
                } else waitingSince = 0;
                youtubeProgress(
                  requestId,
                  player.getCurrentTime(),
                  player.getDuration(),
                );
              }, 500);
            },
            onStateChange: ({ data }) => {
              if (disposed || !ready) return;
              youtubeState(requestId, data);
            },
            onAutoplayBlocked: () => {
              if (!disposed) youtubeBlocked(requestId);
            },
            onError: ({ data }) => fail(youtubeError(data)),
          },
        });
      })
      .catch((reason) =>
        fail(
          reason instanceof Error
            ? reason.message
            : "YouTubeに接続できませんでした",
        ),
      );
    return () => {
      disposed = true;
      clearInterval(timer);
      clearTimeout(deadline);
      player?.destroy();
    };
    // One iframe per playback request; navigation, progress and expansion keep it alive.
  }, [videoId, requestId]);
  const formatTime = (n: number) =>
    `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, "0")}`;
  return (
    <section
      className={`youtube-player ${expanded ? "youtube-expanded" : ""}`}
      aria-label="YouTubeプレーヤー"
    >
      <div className="youtube-heading">
        <div>
          <strong>YouTube</strong>
          <span>ストリーミング再生</span>
        </div>
        <a
          href={`https://www.youtube.com/watch?v=${videoId}`}
          target="_blank"
          rel="noreferrer"
          aria-label="YouTubeで開く"
        >
          <ExternalLink size={18} />
        </a>
        <button
          className="icon-button"
          onClick={() => onExpand(!expanded)}
          aria-label={
            expanded ? "YouTubeプレーヤーを縮小" : "YouTubeプレーヤーを拡大"
          }
          aria-expanded={expanded}
        >
          {expanded ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
        </button>
        <button
          className="icon-button"
          onClick={() => {
            onExpand(false);
            clearPlayback();
          }}
          aria-label="YouTube再生を終了"
        >
          <X size={18} />
        </button>
      </div>
      <div className="youtube-content">
        <div className="youtube-frame" ref={host} />
        <div className="youtube-details">
          <strong>{title}</strong>
          <span>{track?.artist}</span>
          {notice ? (
            <p role="status">{notice}</p>
          ) : (
            <p>
              {status === "loading"
                ? "YouTubeに接続しています…"
                : status === "error"
                  ? error
                  : "通信を使って再生します。MP3保存は曲のメニューから。"}
            </p>
          )}
        </div>
      </div>
      {expanded && (
        <div className="youtube-controls">
          <div className="seek-row">
            <span>{formatTime(time)}</span>
            <input
              type="range"
              aria-label="YouTubeの再生位置"
              min="0"
              max={duration || track?.duration || 1}
              step=".1"
              value={Math.min(time, duration || track?.duration || 1)}
              disabled={!ready}
              onChange={(e) => seek(+e.target.value)}
            />
            <span>{formatTime(duration || track?.duration || 0)}</span>
          </div>
          <div className="youtube-transport">
            <button
              className="icon-button"
              onClick={() => void previous()}
              aria-label="YouTubeの前の曲"
            >
              <SkipBack />
            </button>
            <button
              className="play-button"
              onClick={() => void togglePlayback()}
              aria-label={
                status === "playing" ? "YouTubeを一時停止" : "YouTubeを再生"
              }
            >
              {status === "playing" ? <Pause /> : <Play />}
            </button>
            <button
              className="icon-button"
              onClick={() => void next()}
              aria-label="YouTubeの次の曲"
            >
              <SkipForward />
            </button>
            <Volume2 size={18} />
            <input
              type="range"
              aria-label="YouTubeの音量"
              min="0"
              max="1"
              step=".01"
              value={volume}
              onChange={(e) =>
                useStore.getState().settingsUpdate({ volume: +e.target.value })
              }
            />
          </div>
        </div>
      )}
    </section>
  );
}
