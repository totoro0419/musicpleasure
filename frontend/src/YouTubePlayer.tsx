import { useEffect, useRef } from "react";
import { ExternalLink, Maximize2, Minimize2, X } from "lucide-react";
import {
  usePlayback, connectYouTube, youtubeState, youtubeProgress,
  youtubeBlocked, youtubeFailure, clearPlayback,
} from "./player";
import { useStore } from "./store";
import { loadYouTubeApi, youtubeError } from "./youtube";
import type { YouTubeController } from "./youtube";
import type { Track } from "./types";

export default function YouTubePlayer({track, expanded, onExpand}: {
  track?: Track;
  expanded: boolean;
  onExpand: (value: boolean) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const {videoId, requestId, status, notice, error} = usePlayback();
  const title = track?.title || "YouTube";
  useEffect(() => {
    let disposed = false;
    let ready = false;
    let player: YouTubeController | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let buffering: ReturnType<typeof setTimeout> | undefined;
    const fail = (message: string) => {
      if (disposed) return;
      clearTimeout(deadline);
      clearTimeout(buffering);
      youtubeFailure(requestId, message);
    };
    void loadYouTubeApi().then(api => {
      if (disposed || !host.current) return;
      const iframe = document.createElement("iframe");
      iframe.title = "YouTube: " + title;
      iframe.referrerPolicy = "strict-origin-when-cross-origin";
      iframe.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen; accelerometer; gyroscope; web-share";
      iframe.allowFullscreen = true;
      const params = new URLSearchParams({
        enablejsapi: "1", playsinline: "1", controls: "1", autoplay: "0",
        start: String(Math.floor(useStore.getState().position)),
        origin: location.origin, rel: "0", hl: "ja",
      });
      iframe.src = `https://www.youtube.com/embed/${videoId}?${params}`;
      host.current.replaceChildren(iframe);
      deadline = setTimeout(() => fail("YouTubeプレーヤーに接続できませんでした。再試行するか、YouTubeで開いてください"), 20000);
      player = new api.Player(iframe, {events: {
        onReady: ({target}) => {
          if (disposed) return;
          player = target;
          ready = true;
          clearTimeout(deadline);
          if (!connectYouTube(requestId, target)) return;
          timer = setInterval(() => {
            if (!disposed && ready && player)
              youtubeProgress(requestId, player.getCurrentTime(), player.getDuration());
          }, 500);
        },
        onStateChange: ({data}) => {
          if (disposed || !ready) return;
          clearTimeout(buffering);
          if (data === 3)
            buffering = setTimeout(() => fail("動画の読み込みに時間がかかっています。通信を確認して再試行してください"), 30000);
          youtubeState(requestId, data);
        },
        onAutoplayBlocked: () => {
          if (!disposed) youtubeBlocked(requestId);
        },
        onError: ({data}) => fail(youtubeError(data)),
      }});
    }).catch(reason => fail(reason instanceof Error ? reason.message : "YouTubeに接続できませんでした"));
    return () => {
      disposed = true;
      clearInterval(timer);
      clearTimeout(deadline);
      clearTimeout(buffering);
      player?.destroy();
    };
    // One iframe per playback request; navigation, progress and expansion keep it alive.
  }, [videoId, requestId]);
  return <section className={`youtube-player ${expanded ? "youtube-expanded" : ""}`} aria-label="YouTubeプレーヤー">
    <div className="youtube-heading">
      <div><strong>YouTube</strong><span>ストリーミング再生</span></div>
      <a href={`https://www.youtube.com/watch?v=${videoId}`} target="_blank" rel="noreferrer" aria-label="YouTubeで開く"><ExternalLink size={18}/></a>
      <button className="icon-button" onClick={() => onExpand(!expanded)} aria-label={expanded ? "YouTubeプレーヤーを縮小" : "YouTubeプレーヤーを拡大"} aria-expanded={expanded}>
        {expanded ? <Minimize2 size={18}/> : <Maximize2 size={18}/>}
      </button>
      <button className="icon-button" onClick={() => { onExpand(false); clearPlayback(); }} aria-label="YouTube再生を終了"><X size={18}/></button>
    </div>
    <div className="youtube-content">
      <div className="youtube-frame" ref={host}/>
      <div className="youtube-details">
        <strong>{title}</strong><span>{track?.artist}</span>
        {notice ? <p role="status">{notice}</p> : <p>{status === "loading" ? "YouTubeに接続しています…" : status === "error" ? error : "通信を使って再生します。MP3保存は曲のメニューから。"}</p>}
      </div>
    </div>
  </section>;
}
