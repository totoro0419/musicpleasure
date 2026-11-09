import { useEffect, useRef, useState, useId } from "react";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Activity,
  ArrowDown,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  Disc3,
  Download,
  Ellipsis,
  FolderPlus,
  Headphones,
  Heart,
  Home,
  Library,
  Link,
  ListMusic,
  Loader2,
  Maximize2,
  Music2,
  Pause,
  Play,
  Plus,
  Redo2,
  Repeat,
  Repeat1,
  Search,
  Settings2,
  Shuffle,
  SkipBack,
  SkipForward,
  Sparkles,
  Square,
  Trash2,
  Undo2,
  Upload,
  Volume2,
  WifiOff,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  useStore,
  reorder,
  deduplicateEntries,
  snapshot,
  putTracks,
} from "./store";
import { db } from "./db";
import { sourceKey } from "./cache";
import { api, search, jobs } from "./api";
import {
  usePlayback,
  playTracks,
  togglePlayback,
  previous,
  next,
  seek,
  selectQueue,
  shuffleQueue,
  ensureAudio,
  saveTracks,
  clearPlayback,
  stopPlayback,
} from "./player";
import { kindLabels, normalized, uid } from "./types";
import type { Track, Playlist, DownloadJob } from "./types";
import ImportPanel from "./ImportPanel";

import { localSearch } from "./localSearch";
import { useInstallState, requestInstall } from "./install";

type View =
  | "home"
  | "search"
  | "library"
  | "ai"
  | "favorites"
  | "recent"
  | "downloads"
  | `playlist:${string}`;
type Notify = (s: string) => void;
const formatTime = (n: number) =>
  Number.isFinite(n)
    ? `${Math.floor(n / 60)}:${Math.floor(n % 60)
        .toString()
        .padStart(2, "0")}`
    : "0:00";
const bytes = (n: number) =>
  n > 1024 ** 3
    ? `${(n / 1024 ** 3).toFixed(2)} GB`
    : `${(n / 1024 ** 2).toFixed(1)} MB`;
function IconButton({
  icon: Icon,
  label,
  onClick,
  active,
  disabled,
  className = "",
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      title={label}
      aria-label={label}
      aria-pressed={active === undefined ? undefined : active}
      onClick={onClick}
      disabled={disabled}
      className={`icon-button ${active ? "active" : ""} ${className}`}
    >
      <Icon size={20} />
    </button>
  );
}
function Artwork({ track, large = false }: { track?: Track; large?: boolean }) {
  return (
    <div className={`artwork ${large ? "large" : ""}`}>
      {track?.thumbnail ? (
        <img
          src={track.thumbnail}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />
      ) : (
        <Disc3 size={large ? 72 : 24} />
      )}
    </div>
  );
}
function hashFile(data: ArrayBuffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL("./hash.worker.ts", import.meta.url), {
      type: "module",
    });
    w.onmessage = (e) => {
      w.terminate();
      e.data.error ? reject(new Error(e.data.error)) : resolve(e.data.hash);
    };
    w.onerror = () => {
      w.terminate();
      reject(new Error("ファイル解析に失敗しました"));
    };
    w.postMessage(data);
  });
}
function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  useEffect(() => {
    const old = document.activeElement as HTMLElement;
    const d = ref.current!;
    d.showModal();
    (d.querySelector("input, textarea") as HTMLElement | null)?.focus();
    const pop = () => onClose();
    window.addEventListener("popstate", pop);
    return () => {
      d.close();
      window.removeEventListener("popstate", pop);
      old?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={headingId}
      className={wide ? "wide" : ""}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="dialog-heading">
        <h2 id={headingId}>{title}</h2>
        <IconButton icon={X} label="閉じる" onClick={onClose} />
      </div>
      {children}
    </dialog>
  );
}
export default function App() {
  const s = useStore(),
    playback = usePlayback();
  const install = useInstallState();
  async function installApp() {
    if (!install.available) {
      setInstallHelp(true);
      return;
    }
    try {
      const outcome = await requestInstall();
      if (outcome === "unavailable") setInstallHelp(true);
      if (outcome === "dismissed")
        notify(
          "インストールをキャンセルしました。後から再度お試しいただけます",
        );
      if (outcome === "accepted")
        notify("インストールを受け付けました。完了は端末側で確認してください");
    } catch {
      setInstallHelp(true);
    }
  }
  const [view, setView] = useState<View>(
      () => (location.hash.slice(1) || "home") as View,
    ),
    [q, setQ] = useState(""),
    [debounced, setDebounced] = useState(""),
    [filter, setFilter] = useState("all"),
    [more, setMore] = useState<Track[]>([]),
    [page, setPage] = useState(""),
    [paging, setPaging] = useState(false),
    [notice, setNotice] = useState(""),
    [settings, setSettings] = useState(false),
    [installHelp, setInstallHelp] = useState(false),
    [full, setFull] = useState(false),
    [queueOpen, setQueueOpen] = useState(false),
    [nameModal, setNameModal] = useState<{
      title: string;
      value: string;
      apply: (v: string) => void;
    } | null>(null),
    [addModal, setAddModal] = useState<Track[] | null>(null),
    [online, setOnline] = useState(navigator.onLine),
    [localIds, setLocalIds] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null),
    fileRef = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const notify: Notify = (msg) => {
    setNotice(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setNotice(""), 5500);
  };
  const go = (v: View) => {
    setView(v);
    location.hash = v;
    setQueueOpen(false);
    document.querySelector("main")?.scrollTo(0, 0);
  };
  useEffect(() => {
    const onHash = () => {
      setView((location.hash.slice(1) || "home") as View);
      setFull(false);
      setSettings(false);
    };
    const onOnline = () => setOnline(navigator.onLine);
    window.addEventListener("hashchange", onHash);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOnline);
    return () => {
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOnline);
    };
  }, []);
  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(q.trim());
      setMore([]);
      setPage("");
    }, 350);
    return () => clearTimeout(t);
  }, [q, filter]);
  useEffect(() => {
    void db.assets
      .toArray()
      .then((xs) => setLocalIds(new Set(xs.map((x) => x.id))))
      .catch(() => {});
  }, [playback.cacheRevision]);
  const health = useQuery({
    queryKey: ["health", s.settings.apiUrl, s.settings.token],
    queryFn: async () => {
      const health = await api<{
        status: string;
        youtubeApi: boolean;
        ai: boolean;
        ffmpeg: boolean;
        downloader: boolean;
        capabilities?: { search: boolean; downloads: boolean; ai: boolean };
        authentication: boolean;
      }>("/health");
      if (health.authentication) await api("/jobs");
      return health;
    },
    retry: false,
    refetchInterval: 60000,
  });
  const result = useQuery({
    queryKey: [
      "search",
      debounced,
      filter,
      s.settings.apiUrl,
      s.settings.token,
    ],
    queryFn: ({ signal }) => search(debounced, "", filter, signal),
    enabled: view === "search" && !!debounced,
    retry: false,
  });
  useEffect(() => {
    if (result.data) setPage(result.data.nextPageToken);
  }, [result.data]);
  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (
        ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) ||
        el.isContentEditable ||
        document.querySelector("dialog[open]")
      )
        return;
      if (e.code === "Space") {
        e.preventDefault();
        void togglePlayback();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        e.preventDefault();
        e.shiftKey ? s.redo() : s.undo();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        go("search");
        inputRef.current?.focus();
      }
      if (e.altKey && e.key === "ArrowRight") {
        e.preventDefault();
        void next();
      }
      if (e.altKey && e.key === "ArrowLeft") {
        e.preventDefault();
        void previous();
      }
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  }, [s]);
  const createPlaylist = () =>
    setNameModal({
      title: "新しいプレイリスト",
      value: "",
      apply: (name) => {
        const id = s.createPlaylist(name);
        go(`playlist:${id}`);
        notify("プレイリストを作成しました");
      },
    });
  const openPlaylist = (id: string) => go(`playlist:${id}`);
  const all = Object.values(s.tracks),
    currentEntry = s.queue.find((e) => e.id === s.currentId),
    current = currentEntry ? s.tracks[currentEntry.trackId] : undefined;
  async function importFiles(files: FileList | null) {
    if (!files?.length) return;
    let count = 0;
    for (const file of Array.from(files)) {
      try {
        if (!/\.mp3$/i.test(file.name) || file.size > 150 * 1024 ** 2)
          throw new Error("150MB以下のMP3ファイルを選んでください");
        const data = await file.arrayBuffer(),
          hash = await hashFile(data);
        const id = `local:${hash}`;
        const title = file.name.replace(/\.mp3$/i, "");
        await db.assets.put({
          id,
          sourceId: id,
          blob: new Blob([data], { type: "audio/mpeg" }),
          bytes: file.size,
          createdAt: Date.now(),
        });
        const split = title.split(" - ");
        s.addTracks([
          {
            id,
            title: split.length > 1 ? split.slice(1).join(" - ") : title,
            artist: split.length > 1 ? split[0] : "ローカル音源",
            duration: 0,
            thumbnail: "",
            sources: [
              {
                id,
                provider: "local",
                url: "",
                kind: "local",
                evidence: "端末から読み込んだMP3",
                official: false,
              },
            ],
          },
        ]);
        count++;
      } catch (e) {
        notify((e as Error).message);
      }
    }
    usePlayback.setState((p) => ({ cacheRevision: p.cacheRevision + 1 }));
    if (count) {
      notify(`${count}曲のMP3を読み込みました`);
      go("library");
    }
    if (fileRef.current) fileRef.current.value = "";
  }
  const navs: [View, LucideIcon, string][] = [
    ["home", Home, "ホーム"],
    ["search", Search, "検索"],
    ["library", Library, "ライブラリ"],
    ["ai", Sparkles, "AIスタジオ"],
  ];
  const localResults = debounced ? localSearch(all, q) : [];
  const addTo = (ts: Track[]) => setAddModal(ts);
  const rowsFor = (ts: Track[]) =>
    ts.map((track, i) => ({ id: `${track.id}-${i}`, track }));
  const listProps = { notify, addTo, localIds };
  const p = view.startsWith("playlist:")
    ? s.playlists.find((p) => p.id === view.slice(9))
    : undefined;
  async function nextPage() {
    if (paging || !page) return;
    setPaging(true);
    try {
      const v = await search(debounced, page, filter);
      setMore((m) => [...m, ...v.items]);
      setPage(v.nextPageToken);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setPaging(false);
    }
  }
  function exportPlaylist(p: Playlist, format: "json" | "text") {
    const ts = p.entries.map((e) => s.tracks[e.trackId]);
    const text =
      format === "json"
        ? JSON.stringify(
            ts.map((t) => ({
              title: t.title,
              artist: t.artist,
              url: t.sources.find((a) => a.provider === "youtube")?.url,
            })),
            null,
            2,
          )
        : ts.map((t) => `${t.artist} - ${t.title}`).join("\n");
    void navigator.clipboard
      .writeText(text)
      .then(() => notify("クリップボードへコピーしました"))
      .catch(() => {
        downloadFile(text, `${p.name}.${format === "json" ? "json" : "txt"}`);
        notify("ファイルに書き出しました");
      });
  }
  if (!s.loaded)
    return (
      <div className="loading-screen">
        <Activity />
        <p>ライブラリを読み込んでいます</p>
      </div>
    );
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        コンテンツへ移動
      </a>
      <aside className="sidebar">
        <a className="brand" href="#home" onClick={() => go("home")}>
          <span className="brand-mark">
            <Activity size={24} />
          </span>
          <span>
            Music<span className="brand-light">Pleasure</span>
            <small>YOUR SOUND. YOUR SPACE.</small>
          </span>
        </a>
        <nav aria-label="メインナビゲーション">
          {navs.map(([id, Icon, label]) => (
            <a
              href={"#" + id}
              key={id}
              onClick={() => go(id)}
              className={view === id ? "selected" : ""}
              aria-current={view === id ? "page" : undefined}
            >
              <Icon size={20} />
              {label}
              {id === "ai" && <span className="tiny-tag">AI</span>}
            </a>
          ))}
        </nav>
        <div className="side-divider" />
        <div className="side-label">マイコレクション</div>
        <a
          className={`side-link ${view === "favorites" ? "selected" : ""}`}
          href="#favorites"
          onClick={() => go("favorites")}
        >
          <Heart size={18} />
          お気に入り<span>{s.favorites.length}</span>
        </a>
        <a
          className={`side-link ${view === "recent" ? "selected" : ""}`}
          href="#recent"
          onClick={() => go("recent")}
        >
          <Clock size={18} />
          最近再生した曲
        </a>
        <a
          className={`side-link ${view === "downloads" ? "selected" : ""}`}
          href="#downloads"
          onClick={() => go("downloads")}
        >
          <ArrowDownToLine size={18} />
          ダウンロード
        </a>
        <div className="playlist-label">
          <span>プレイリスト</span>
          <IconButton
            icon={Plus}
            label="プレイリストを作成"
            onClick={createPlaylist}
          />
        </div>
        <div className="side-playlists">
          {s.playlists.map((p, i) => (
            <a
              key={p.id}
              className={view === `playlist:${p.id}` ? "selected" : ""}
              href={`#playlist:${p.id}`}
              onClick={() => openPlaylist(p.id)}
            >
              <span className={`playlist-mini color-${i % 4}`}>
                <ListMusic size={16} />
              </span>
              <span>
                {p.name}
                <small>{p.entries.length}曲</small>
              </span>
            </a>
          ))}
          {!s.playlists.length && (
            <p className="sidebar-empty">
              まだプレイリストがありません。
              <br />
              ＋から、あなただけの音楽を。
            </p>
          )}
        </div>
        <div className="sidebar-bottom">
          <button onClick={() => setSettings(true)}>
            <Settings2 size={18} />
            設定・接続
          </button>
          <span className="version">
            MusicPleasure <b>0.1</b>
          </span>
        </div>
      </aside>
      <main id="main">
        <header className="topbar">
          <div className="history-buttons">
            <IconButton
              icon={ArrowLeft}
              label="戻る"
              onClick={() => history.back()}
            />
            <IconButton
              icon={ArrowRight}
              label="進む"
              onClick={() => history.forward()}
            />
          </div>
          <form
            className="global-search"
            onSubmit={(e) => {
              e.preventDefault();
              go("search");
              setDebounced(q.trim());
            }}
          >
            <Search size={19} />
            <input
              ref={inputRef}
              aria-label="曲・アーティスト・YouTube URLを検索"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                if (view !== "search") go("search");
              }}
              placeholder="曲、アーティスト、YouTube URLを検索"
            />
            <kbd>⌘ K</kbd>
            {q && (
              <IconButton
                icon={X}
                label="検索語を消す"
                onClick={() => setQ("")}
              />
            )}
          </form>
          <button
            className={`connection ${health.data ? "connected" : ""}`}
            onClick={() => setSettings(true)}
          >
            <span />
            {health.data
              ? health.data.capabilities?.downloads === false
                ? "検索接続済み"
                : "バックエンド接続済み"
              : "接続を確認中"}
          </button>
          {!install.installed && (
            <button
              className="install-button"
              onClick={() => void installApp()}
              disabled={install.busy}
              aria-label="MusicPleasureをインストール"
            >
              <Download size={17} />
              <span>{install.busy ? "確認中…" : "インストール"}</span>
            </button>
          )}
          <IconButton
            className="mobile-settings"
            icon={Settings2}
            label="設定"
            onClick={() => setSettings(true)}
          />
          <div className="avatar">M</div>
        </header>
        {!online && (
          <div className="offline-banner">
            <WifiOff size={16} />
            オフライン · 保存したMP3を再生できます
          </div>
        )}
        {s.saveError && (
          <div className="error-box" role="alert">
            {s.saveError}
          </div>
        )}
        <div className="page-content">
          {view === "home" && (
            <>
              <div className="greeting">
                <span>YOUR PERSONAL SOUNDTRACK</span>
                <p>おかえりなさい。今日は、どんな気分？</p>
              </div>
              <section className="hero">
                <div className="hero-copy">
                  <div className="eyebrow">
                    <span className="spark-dot" /> MUSIC WITHOUT LIMITS
                  </div>
                  <h1>
                    音楽に、
                    <br />
                    もっと自由を。
                  </h1>
                  <p>
                    好きな曲も、まだ知らない一曲も。
                    <br />
                    あなただけの音楽体験を、ここから。
                  </p>
                  <button
                    className="primary light"
                    onClick={() => {
                      go("search");
                      inputRef.current?.focus();
                    }}
                  >
                    <Search size={19} />
                    音楽を探す
                    <ArrowRight size={18} />
                  </button>
                  <span className="hero-caption">
                    DISCOVER. COLLECT. MAKE IT YOURS.
                  </span>
                </div>
                <div className="hero-art" aria-hidden="true">
                  <div className="orbital orbital-1" />
                  <div className="orbital orbital-2" />
                  <div className="disc">
                    <div className="disc-label">
                      <Activity size={42} />
                      <span>MP / 01</span>
                    </div>
                  </div>
                  <div className="floating-note">
                    <span className="equalizer">
                      <i />
                      <i />
                      <i />
                      <i />
                    </span>
                    <span>
                      Just you.
                      <br />
                      <b>And the music.</b>
                    </span>
                  </div>
                  <span className="art-number">01 / ∞</span>
                </div>
              </section>
              <div className="quick-actions">
                <button onClick={() => go("ai")}>
                  <span className="quick-icon purple">
                    <Sparkles />
                  </span>
                  <span>
                    <strong>AIで、ひらめきを音楽に</strong>
                    <small>曲一覧を貼り付けて、一括登録</small>
                  </span>
                  <ArrowRight size={18} />
                </button>
                <button onClick={() => fileRef.current?.click()}>
                  <span className="quick-icon teal">
                    <Upload />
                  </span>
                  <span>
                    <strong>手元の音楽も、ひとつに</strong>
                    <small>MP3を読み込んでオフライン再生</small>
                  </span>
                  <ArrowRight size={18} />
                </button>
              </div>
              <div className="section-title">
                <div>
                  <h2>あなたのプレイリスト</h2>
                  <p>好きな音楽を、好きなかたちで。</p>
                </div>
                <button className="text-button" onClick={() => go("library")}>
                  すべて見る
                  <ChevronRight size={16} />
                </button>
              </div>
              <div className="playlist-grid">
                {s.playlists.slice(0, 5).map((p, i) => (
                  <PlaylistCard
                    key={p.id}
                    playlist={p}
                    index={i}
                    onClick={() => openPlaylist(p.id)}
                  />
                ))}
                <button className="new-playlist-card" onClick={createPlaylist}>
                  <span>
                    <Plus size={30} />
                  </span>
                  <strong>新しいプレイリスト</strong>
                  <small>あなたの「好き」を集めよう</small>
                </button>
              </div>
              <section className="home-lower">
                <div>
                  <div className="section-title">
                    <h2>
                      {s.history.length
                        ? "もう一度、聴きたい曲"
                        : "次のお気に入りを、見つけよう。"}
                    </h2>
                    {s.history.length > 0 && (
                      <button
                        className="text-button"
                        onClick={() => go("recent")}
                      >
                        すべて見る
                        <ChevronRight size={16} />
                      </button>
                    )}
                  </div>
                  {s.history.length ? (
                    <TrackList
                      rows={rowsFor(
                        [...new Set(s.history.map((h) => h.trackId))]
                          .slice(0, 5)
                          .map((id) => s.tracks[id]),
                      )}
                      {...listProps}
                    />
                  ) : (
                    <div className="start-note">
                      <Headphones size={38} />
                      <div>
                        <h3>最初の一曲から、はじまる。</h3>
                        <p>
                          上の検索バーからYouTubeを検索。
                          <br />
                          保存した音楽は、ここに集まります。
                        </p>
                      </div>
                      <button
                        onClick={() => go("search")}
                        aria-label="検索を開く"
                      >
                        <ArrowRight />
                      </button>
                    </div>
                  )}
                </div>
                <div className="small-ai-card">
                  <Sparkles size={23} />
                  <span>MADE FOR YOUR MIND</span>
                  <h3>
                    「夜に聴きたい曲」
                    <br />
                    そのひと言から。
                  </h3>
                  <p>AIで、音楽との出会いをもっと自由に。</p>
                  <button className="text-button" onClick={() => go("ai")}>
                    AIスタジオを開く
                    <ArrowRight size={16} />
                  </button>
                </div>
              </section>
              <footer className="page-footer">
                <Activity size={15} /> 音楽と、あなたのあいだに。
                <span>MusicPleasure</span>
              </footer>
            </>
          )}
          {view === "search" && (
            <>
              <div className="eyebrow">FIND YOUR NEXT FAVORITE</div>
              <div className="section-title">
                <h1>
                  {debounced
                    ? `「${debounced.length > 30 ? debounced.slice(0, 30) + "…" : debounced}」`
                    : "音楽を探す"}
                </h1>
                <button className="text-button" onClick={() => go("ai")}>
                  <ClipboardIcon />
                  一括検索
                </button>
              </div>
              <div className="chips">
                {[
                  ["all", "すべて"],
                  ["audio", "音源"],
                  ["mv", "MV"],
                  ["live", "ライブ"],
                  ["cover", "カバー"],
                  ["remix", "リミックス"],
                ].map(([id, label]) => (
                  <button
                    key={id}
                    className={filter === id ? "active" : ""}
                    onClick={() => setFilter(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {!!localResults.length && (
                <>
                  <h2 className="list-heading">ライブラリ内の候補</h2>
                  <TrackList rows={rowsFor(localResults)} {...listProps} />
                </>
              )}
              {result.isFetching && (
                <p className="loading-inline" role="status">
                  <Loader2 className="spin" />
                  YouTubeを検索しています
                </p>
              )}
              {result.error && (
                <div className="error-box" role="alert">
                  <p>{result.error.message}</p>
                  <button onClick={() => void result.refetch()}>再試行</button>
                  <button onClick={() => setSettings(true)}>接続設定</button>
                </div>
              )}
              {result.data && (
                <>
                  <div className="section-title">
                    <h2>YouTubeの検索結果</h2>
                    <span className="muted small">
                      {result.data.provider} · 分類はタイトル表記が根拠です
                    </span>
                  </div>
                  <TrackList
                    rows={rowsFor([...result.data.items, ...more])}
                    {...listProps}
                  />
                  {page && (
                    <button
                      className="load-more"
                      disabled={paging}
                      onClick={() => void nextPage()}
                    >
                      {paging ? "読み込み中…" : "さらに読み込む"}
                    </button>
                  )}
                  {!result.data.items.length && (
                    <Empty
                      icon={Search}
                      title="候補が見つかりませんでした"
                      text="曲名やアーティスト名の表記を変えて検索してください。"
                    />
                  )}
                </>
              )}
              {!debounced && (
                <div className="search-empty">
                  <div className="search-orbit">
                    <Search size={48} />
                  </div>
                  <h2>今日は、何を聴こう？</h2>
                  <p>
                    曲名・アーティスト名・アルバム名で検索。
                    <br />
                    YouTubeの動画やプレイリストURLも、そのまま。
                  </p>
                  <button
                    className="secondary"
                    onClick={() => inputRef.current?.focus()}
                  >
                    検索バーに入力
                    <ArrowUp size={17} />
                  </button>
                </div>
              )}
            </>
          )}
          {["library", "favorites", "recent"].includes(view) && (
            <LibraryView
              view={view}
              onCreate={createPlaylist}
              openPlaylist={openPlaylist}
              navigate={go}
              importFiles={() => fileRef.current?.click()}
              {...listProps}
            />
          )}
          {p && (
            <>
              <div className="playlist-header">
                <div
                  className={`playlist-cover color-${s.playlists.indexOf(p) % 4}`}
                >
                  <ListMusic size={70} />
                </div>
                <div>
                  <span className="eyebrow">YOUR PLAYLIST</span>
                  <h1>{p.name}</h1>
                  <p>
                    {p.entries.length}曲 ·{" "}
                    {formatTime(
                      p.entries.reduce(
                        (n, e) => n + (s.tracks[e.trackId]?.duration || 0),
                        0,
                      ),
                    )}
                  </p>
                  <div className="button-row">
                    <button
                      className="primary"
                      disabled={!p.entries.length}
                      onClick={() =>
                        void playTracks(
                          p.entries.map((e) => s.tracks[e.trackId]),
                        )
                      }
                    >
                      <Play fill="currentColor" size={17} />
                      再生
                    </button>
                    <IconButton
                      icon={Shuffle}
                      label="ランダムに並べ替え"
                      onClick={() =>
                        s.updatePlaylist(p.id, (v) => {
                          for (let i = v.entries.length - 1; i > 0; i--) {
                            const j = Math.floor(Math.random() * (i + 1));
                            [v.entries[i], v.entries[j]] = [
                              v.entries[j],
                              v.entries[i],
                            ];
                          }
                        })
                      }
                    />
                    <details className="action-menu">
                      <summary
                        role="button"
                        aria-label="プレイリストのメニュー"
                      >
                        <Ellipsis />
                      </summary>
                      <div>
                        <button
                          onClick={() =>
                            setNameModal({
                              title: "名前を変更",
                              value: p.name,
                              apply: (v) =>
                                s.updatePlaylist(p.id, (t) => {
                                  t.name = v;
                                }),
                            })
                          }
                        >
                          名前を変更
                        </button>
                        <button
                          onClick={() => {
                            s.updatePlaylist(p.id, (v) =>
                              deduplicateEntries(v, s.tracks),
                            );
                            notify("重複を整理しました。取り消し可能です");
                          }}
                        >
                          重複を削除
                        </button>
                        <button
                          onClick={() =>
                            s.updatePlaylist(p.id, (v) => {
                              v.entries.sort((a, b) =>
                                s.tracks[a.trackId].title.localeCompare(
                                  s.tracks[b.trackId].title,
                                  "ja",
                                ),
                              );
                            })
                          }
                        >
                          曲名順
                        </button>
                        <button
                          onClick={() =>
                            s.updatePlaylist(p.id, (v) => {
                              v.entries.sort((a, b) =>
                                s.tracks[a.trackId].artist.localeCompare(
                                  s.tracks[b.trackId].artist,
                                  "ja",
                                ),
                              );
                            })
                          }
                        >
                          アーティスト順
                        </button>
                        <button onClick={() => exportPlaylist(p, "text")}>
                          テキストをコピー
                        </button>
                        <button onClick={() => exportPlaylist(p, "json")}>
                          JSONをコピー
                        </button>
                        <button
                          onClick={() =>
                            addTo(p.entries.map((e) => s.tracks[e.trackId]))
                          }
                        >
                          別のプレイリストと結合
                        </button>
                        <button
                          className="danger"
                          onClick={() => {
                            s.deletePlaylist(p.id);
                            go("library");
                            notify(
                              "プレイリストを削除しました。取り消し可能です",
                            );
                          }}
                        >
                          削除
                        </button>
                      </div>
                    </details>
                  </div>
                </div>
              </div>
              <TrackList
                rows={p.entries.map((e) => ({
                  id: e.id,
                  track: s.tracks[e.trackId],
                }))}
                playlist={p}
                {...listProps}
              />
              {!p.entries.length && (
                <Empty
                  icon={ListMusic}
                  title="あなたの選曲を、ここに。"
                  text="検索結果の＋から曲を追加するか、AIスタジオで曲一覧を取り込みましょう。"
                />
              )}
            </>
          )}
          {view === "ai" && (
            <ImportPanel notify={notify} openPlaylist={openPlaylist} />
          )}
          {view === "downloads" && <Downloads notify={notify} />}
        </div>
      </main>
      <aside className={`queue-panel ${queueOpen ? "mobile-open" : ""}`}>
        <div className="section-title">
          <h2>
            再生キュー <span>{s.queue.length}</span>
          </h2>
          <IconButton
            icon={X}
            label="キューを閉じる"
            onClick={() => setQueueOpen(false)}
            className="queue-close"
          />
        </div>
        <div className="queue-tabs">
          <span>次に再生</span>
          <button
            onClick={() => {
              clearPlayback();
              useStore.setState({ queue: [] });
              notify("再生キューをクリアしました");
            }}
            disabled={!s.queue.length}
          >
            クリア
          </button>
        </div>
        {s.queue.length ? (
          <div className="queue-list">
            {s.queue.map((e, i) => (
              <div
                key={e.id}
                className={`queue-row ${e.id === s.currentId ? "current" : ""}`}
              >
                <button
                  className="queue-select"
                  onClick={() => selectQueue(e.id)}
                >
                  <Artwork track={s.tracks[e.trackId]} />
                  <span>
                    <strong>{s.tracks[e.trackId].title}</strong>
                    <small>{s.tracks[e.trackId].artist}</small>
                  </span>
                  {e.id === s.currentId && <Activity size={16} />}
                </button>
                <details className="action-menu">
                  <summary role="button" aria-label="キューの曲操作">
                    <Ellipsis size={17} />
                  </summary>
                  <div>
                    <button
                      disabled={!i}
                      onClick={() =>
                        useStore.setState({ queue: reorder(s.queue, i, i - 1) })
                      }
                    >
                      上へ移動
                    </button>
                    <button
                      disabled={i === s.queue.length - 1}
                      onClick={() =>
                        useStore.setState({ queue: reorder(s.queue, i, i + 1) })
                      }
                    >
                      下へ移動
                    </button>
                    <button
                      onClick={() => {
                        if (e.id === s.currentId) clearPlayback();
                        useStore.setState({
                          queue: s.queue.filter((q) => q.id !== e.id),
                        });
                      }}
                    >
                      キューから削除
                    </button>
                  </div>
                </details>
              </div>
            ))}
          </div>
        ) : (
          <div className="queue-empty">
            <div className="queue-empty-art">
              <ListMusic size={32} />
            </div>
            <h3>音楽を、つなげよう。</h3>
            <p>
              曲を再生すると、次の曲が
              <br />
              ここに表示されます。
            </p>
            <button className="text-button" onClick={() => go("search")}>
              曲を探す
              <ArrowRight size={15} />
            </button>
          </div>
        )}
        <div className="queue-bottom">
          <Headphones size={16} />
          <span>あなたのペースで、あなたの音楽を。</span>
        </div>
      </aside>
      <div className="player-bar">
        <button
          className="now-playing"
          onClick={() => setFull(true)}
          aria-label="フルプレーヤーを開く"
        >
          <Artwork track={current} />
          <span>
            <strong>{current?.title || "音楽を、はじめよう。"}</strong>
            <small>
              {playback.status === "loading"
                ? `${playback.phase || "音源を準備中"}…`
                : current?.artist || "最初の一曲を選んでください"}
            </small>
          </span>
        </button>
        {current && (
          <IconButton
            icon={Heart}
            label="お気に入り"
            active={s.favorites.includes(current.id)}
            onClick={() => s.favorite(current.id)}
          />
        )}
        <div className="player-center">
          <div className="transport">
            <IconButton
              icon={Shuffle}
              label="シャッフル"
              active={s.settings.shuffle}
              onClick={shuffleQueue}
            />
            <IconButton
              icon={SkipBack}
              label="前の曲"
              onClick={() => void previous()}
              disabled={!current}
            />
            <button
              className="play-button"
              aria-label={playback.status === "playing" ? "一時停止" : "再生"}
              disabled={!current}
              onClick={() => void togglePlayback()}
            >
              {playback.status === "loading" ? (
                <Loader2 size={22} className="spin" />
              ) : playback.status === "playing" ? (
                <Pause size={21} fill="currentColor" />
              ) : (
                <Play size={22} fill="currentColor" />
              )}
            </button>
            <IconButton
              icon={SkipForward}
              label="次の曲"
              onClick={() => void next()}
              disabled={!current}
            />
            <IconButton
              icon={s.settings.repeat === "one" ? Repeat1 : Repeat}
              label={`リピート: ${s.settings.repeat}`}
              active={s.settings.repeat !== "none"}
              onClick={() =>
                s.settingsUpdate({
                  repeat:
                    s.settings.repeat === "none"
                      ? "all"
                      : s.settings.repeat === "all"
                        ? "one"
                        : "none",
                })
              }
            />
          </div>
          <div className="seek-row">
            <span>{formatTime(playback.time || s.position)}</span>
            <input
              type="range"
              aria-label="再生位置"
              min="0"
              max={playback.duration || current?.duration || 1}
              step=".1"
              value={Math.min(
                playback.time || s.position,
                playback.duration || current?.duration || 1,
              )}
              disabled={!current || !playback.ready}
              onChange={(e) => seek(+e.target.value)}
            />
            <span>
              {formatTime(playback.duration || current?.duration || 0)}
            </span>
          </div>
        </div>
        <div className="player-right">
          <IconButton
            icon={ListMusic}
            label="再生キュー"
            onClick={() => setQueueOpen((v) => !v)}
            active={queueOpen}
          />
          <Volume2 size={19} />
          <input
            type="range"
            aria-label="音量"
            min="0"
            max="1"
            step=".01"
            value={s.settings.volume}
            onChange={(e) => s.settingsUpdate({ volume: +e.target.value })}
          />
          <IconButton
            icon={Maximize2}
            label="プレーヤーを拡大"
            onClick={() => setFull(true)}
          />
        </div>
        <div className="mobile-play">
          <IconButton
            icon={playback.status === "playing" ? Pause : Play}
            label={playback.status === "playing" ? "一時停止" : "再生"}
            onClick={() => void togglePlayback()}
            disabled={!current}
          />
          <IconButton
            icon={SkipForward}
            label="次の曲"
            onClick={() => void next()}
            disabled={!current}
          />
        </div>
      </div>
      <nav className="mobile-nav" aria-label="モバイルナビゲーション">
        {navs.map(([id, Icon, label]) => (
          <a
            href={"#" + id}
            key={id}
            className={view === id ? "selected" : ""}
            onClick={() => go(id)}
          >
            <Icon size={21} />
            <span>{id === "ai" ? "AI" : label}</span>
          </a>
        ))}
      </nav>
      {playback.status === "error" && (
        <div className="playback-error" role="alert">
          <span>{playback.error}</span>
          <button onClick={() => void togglePlayback()}>再試行</button>
          <button onClick={() => void next()}>スキップ</button>
          <IconButton
            icon={X}
            label="エラーを閉じる"
            onClick={() =>
              usePlayback.setState({ status: "paused", error: "" })
            }
          />
        </div>
      )}
      {notice && (
        <div className="toast" role="status">
          <Check size={17} />
          {notice}
          <button
            onClick={() => {
              s.undo();
              setNotice("取り消しました");
            }}
            disabled={!s.past.length}
          >
            取り消す
          </button>
        </div>
      )}
      <div className="undo-controls">
        <IconButton
          icon={Undo2}
          label="取り消し (Ctrl+Z)"
          onClick={s.undo}
          disabled={!s.past.length}
        />
        <IconButton
          icon={Redo2}
          label="やり直し (Ctrl+Shift+Z)"
          onClick={s.redo}
          disabled={!s.future.length}
        />
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="audio/mpeg,.mp3"
        multiple
        hidden
        onChange={(e) => void importFiles(e.target.files)}
      />
      {installHelp && (
        <Modal
          title="MusicPleasureをインストール"
          onClose={() => setInstallHelp(false)}
        >
          <div className="install-help">
            <p>ブラウザのメニューから、アプリとして追加できます。</p>
            <ol>
              <li>
                <strong>Android（Chrome / Edge）</strong>
                <p>
                  右上の「⋮」→「アプリをインストール」または「ホーム画面に追加」を選びます。
                </p>
              </li>
              <li>
                <strong>Windows（Chrome / Edge）</strong>
                <p>
                  アドレスバーのインストールアイコン、またはブラウザのメニューから「インストール」「このサイトをアプリとしてインストール」を選びます。
                </p>
              </li>
              <li>
                <strong>iPhone / iPad（Safari）</strong>
                <p>共有ボタン→「ホーム画面に追加」を選びます。</p>
              </li>
            </ol>
            <p className="muted small">
              アプリ内ブラウザでは追加できないことがあります。その場合はChromeやEdgeでこのページを開いてください。既に追加済みの場合は、端末のアプリ一覧を確認してください。
            </p>
            <div className="dialog-actions">
              <button className="primary" onClick={() => setInstallHelp(false)}>
                わかりました
              </button>
            </div>
          </div>
        </Modal>
      )}
      {settings && (
        <Modal title="設定・接続" onClose={() => setSettings(false)}>
          <SettingsPanel
            health={health.data}
            healthError={health.error?.message}
            notify={notify}
            refresh={() => void health.refetch()}
          />
        </Modal>
      )}
      {nameModal && (
        <Modal title={nameModal.title} onClose={() => setNameModal(null)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (nameModal.value.trim()) {
                nameModal.apply(nameModal.value.trim());
                setNameModal(null);
              }
            }}
          >
            <label>
              プレイリスト名
              <input
                autoFocus
                maxLength={200}
                required
                value={nameModal.value}
                onChange={(e) =>
                  setNameModal({ ...nameModal, value: e.target.value })
                }
              />
            </label>
            <div className="dialog-actions">
              <button type="button" onClick={() => setNameModal(null)}>
                キャンセル
              </button>
              <button className="primary" type="submit">
                保存
              </button>
            </div>
          </form>
        </Modal>
      )}
      {addModal && (
        <Modal
          title={`${addModal.length}曲をプレイリストに追加`}
          onClose={() => setAddModal(null)}
        >
          <div className="add-list">
            {s.playlists.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  s.addTracks(addModal);
                  s.updatePlaylist(p.id, (v) =>
                    v.entries.push(
                      ...addModal.map((t) => ({ id: uid(), trackId: t.id })),
                    ),
                  );
                  setAddModal(null);
                  notify(`${p.name}に追加しました`);
                }}
              >
                <ListMusic />
                {p.name}
                <Plus size={18} />
              </button>
            ))}
            <button
              onClick={() => {
                const ts = addModal;
                setAddModal(null);
                setNameModal({
                  title: "新しいプレイリスト",
                  value: "",
                  apply: (name) => {
                    const id = s.createPlaylist(name, ts);
                    openPlaylist(id);
                  },
                });
              }}
            >
              <FolderPlus />
              新しいプレイリストを作成
            </button>
          </div>
        </Modal>
      )}
      {full && (
        <Modal title="再生中" wide onClose={() => setFull(false)}>
          <div className="full-player">
            <Artwork track={current} large />
            <h2>{current?.title || "再生する曲を選んでください"}</h2>
            <p>{current?.artist || "MusicPleasure"}</p>
            <div className="seek-row">
              <span>{formatTime(playback.time)}</span>
              <input
                aria-label="フルプレーヤーの再生位置"
                type="range"
                min="0"
                max={playback.duration || 1}
                step=".1"
                value={playback.time}
                disabled={!playback.ready}
                onChange={(e) => seek(+e.target.value)}
              />
              <span>{formatTime(playback.duration)}</span>
            </div>
            <div className="full-transport">
              <IconButton
                icon={Shuffle}
                label="シャッフル"
                active={s.settings.shuffle}
                onClick={shuffleQueue}
              />
              <IconButton
                icon={SkipBack}
                label="前の曲"
                onClick={() => void previous()}
              />
              <button
                className="play-button"
                disabled={!current}
                aria-label="再生・停止"
                onClick={() => void togglePlayback()}
              >
                {playback.status === "playing" ? (
                  <Pause fill="currentColor" />
                ) : (
                  <Play fill="currentColor" />
                )}
              </button>
              <IconButton
                icon={SkipForward}
                label="次の曲"
                onClick={() => void next()}
              />
              <IconButton
                icon={s.settings.repeat === "one" ? Repeat1 : Repeat}
                label="リピート"
                active={s.settings.repeat !== "none"}
                onClick={() =>
                  s.settingsUpdate({
                    repeat:
                      s.settings.repeat === "none"
                        ? "all"
                        : s.settings.repeat === "all"
                          ? "one"
                          : "none",
                  })
                }
              />
            </div>
            <div className="full-tools">
              <IconButton icon={Square} label="停止" onClick={stopPlayback} disabled={!current} />
              <IconButton
                icon={Heart}
                label="お気に入り"
                active={!!current && s.favorites.includes(current.id)}
                onClick={() => current && s.favorite(current.id)}
              />
              <IconButton
                icon={Plus}
                label="プレイリストに追加"
                onClick={() => current && addTo([current])}
              />
              <Volume2 size={19} />
              <input
                type="range"
                aria-label="フルプレーヤーの音量"
                min="0"
                max="1"
                step=".01"
                value={s.settings.volume}
                onChange={(e) => s.settingsUpdate({ volume: +e.target.value })}
              />
              <IconButton
                icon={ListMusic}
                label="キューを表示"
                onClick={() => {
                  setFull(false);
                  setQueueOpen(true);
                }}
              />
            </div>
            <p className="muted small">
              {playback.status === "loading"
                ? playback.phase || "MP3音源を準備しています"
                : playback.status === "error"
                  ? playback.error
                  : playback.status === "playing"
                    ? "再生中"
                    : current
                      ? "一時停止中"
                      : ""}
            </p>
          </div>
        </Modal>
      )}
    </div>
  );
}
function ClipboardIcon() {
  return <Copy size={16} />;
}
function Empty({
  icon: Icon,
  title,
  text,
}: {
  icon: LucideIcon;
  title: string;
  text: string;
}) {
  return (
    <div className="empty-state">
      <Icon size={40} />
      <h2>{title}</h2>
      <p>{text}</p>
    </div>
  );
}
function PlaylistCard({
  playlist: p,
  index,
  onClick,
}: {
  playlist: Playlist;
  index: number;
  onClick: () => void;
}) {
  const tracks = useStore((s) => s.tracks),
    thumbnail = p.entries
      .map((e) => tracks[e.trackId]?.thumbnail)
      .find(Boolean);
  return (
    <button className="playlist-card" onClick={onClick}>
      <div className={`playlist-cover color-${index % 4}`}>
        {thumbnail ? (
          <img loading="lazy" src={thumbnail} alt="" />
        ) : (
          <>
            <div className="cover-ring" />
            <ListMusic size={48} />
            <span>{String(index + 1).padStart(2, "0")}</span>
          </>
        )}
        <span className="cover-play">
          <Play fill="currentColor" size={20} />
        </span>
      </div>
      <strong>{p.name}</strong>
      <small>プレイリスト · {p.entries.length}曲</small>
    </button>
  );
}
interface ListProps {
  notify: Notify;
  addTo: (ts: Track[]) => void;
  localIds: Set<string>;
}
function TrackList({
  rows,
  playlist,
  notify,
  addTo,
  localIds,
}: { rows: { id: string; track: Track }[]; playlist?: Playlist } & ListProps) {
  const s = useStore(),
    [selected, setSelected] = useState<Set<string>>(new Set()),
    [target, setTarget] = useState(""),
    [drag, setDrag] = useState(-1);
  const parent = useRef<HTMLDivElement>(null);
  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parent.current,
    estimateSize: () => 80,
    overscan: 8,
  });
  const chosen = rows.filter((r) => selected.has(r.id));
  const bulkTracks = chosen.map((r) => r.track);
  useEffect(() => setSelected(new Set()), [playlist?.id, rows.length]);
  const move = (i: number, j: number) => {
    if (playlist)
      s.updatePlaylist(playlist.id, (p) => {
        p.entries = reorder(p.entries, i, j);
      });
  };
  function bulk(moveIt: boolean) {
    if (!target) return;
    s.edit((d) => {
      putTracks(d, bulkTracks);
      const dest = d.playlists.find((p) => p.id === target);
      dest?.entries.push(
        ...bulkTracks.map((t) => ({ id: uid(), trackId: t.id })),
      );
      if (moveIt && playlist) {
        const origin = d.playlists.find((p) => p.id === playlist.id);
        if (origin)
          origin.entries = origin.entries.filter((e) => !selected.has(e.id));
      }
    });
    setSelected(new Set());
    notify(moveIt ? "選択した曲を移動しました" : "選択した曲をコピーしました");
  }
  const render = (row: { id: string; track: Track }, i: number) => {
    const t = row.track;
    if (!t) return null;
    const saved = t.sources.some((a) => localIds.has(a.id));
    return (
      <div
        key={row.id}
        className={`track-row ${selected.has(row.id) ? "selected" : ""}`}
        draggable={!!playlist}
        onDragStart={() => setDrag(i)}
        onDragOver={(e) => {
          if (playlist) e.preventDefault();
        }}
        onDrop={() => {
          if (drag >= 0) move(drag, i);
          setDrag(-1);
        }}
      >
        <input
          type="checkbox"
          aria-label={`${t.title}を選択`}
          checked={selected.has(row.id)}
          onChange={(e) =>
            setSelected((old) => {
              const n = new Set(old);
              e.target.checked ? n.add(row.id) : n.delete(row.id);
              return n;
            })
          }
        />
        <button
          className="track-play"
          aria-label={`${t.title}を再生`}
          onClick={() =>
            void playTracks(
              rows.map((r) => r.track),
              i,
            )
          }
        >
          <Artwork track={t} />
          <Play className="overlay-play" size={18} fill="currentColor" />
        </button>
        <div className="track-info">
          <strong>{t.title}</strong>
          <small>
            {t.artist}
            <span className="kind" title={t.sources[0]?.evidence}>
              {kindLabels[t.sources[0]?.kind || "unknown"]}
            </span>
            {saved && (
              <span className="downloaded">
                <Check size={12} />
                保存済み
              </span>
            )}
          </small>
        </div>
        <span className="track-time">{formatTime(t.duration)}</span>
        <IconButton
          icon={Heart}
          label={`${t.title}をお気に入り`}
          active={s.favorites.includes(t.id)}
          onClick={() => {
            s.addTracks([t]);
            s.favorite(t.id);
          }}
        />
        <IconButton
          icon={Plus}
          label={`${t.title}をプレイリストへ追加`}
          onClick={() => addTo([t])}
        />
        <details className="action-menu">
          <summary role="button" aria-label={`${t.title}の操作`}>
            <Ellipsis size={20} />
          </summary>
          <div>
            <button
              onClick={() => {
                s.enqueue([t], true);
                notify("次に再生します");
              }}
            >
              次に再生
            </button>
            <button
              onClick={() => {
                s.enqueue([t]);
                notify("キューに追加しました");
              }}
            >
              キュー末尾に追加
            </button>
            <button
              onClick={() => {
                s.addTracks([t]);
                notify("ライブラリへ追加しました");
              }}
            >
              ライブラリに追加
            </button>
            <button
              disabled={saved}
              onClick={() => {
                s.addTracks([t]);
                notify("MP3の保存を開始しました");
                void ensureAudio(t)
                  .then(() => notify("MP3を端末に保存しました"))
                  .catch((e) => notify(e.message));
              }}
            >
              MP3を保存
            </button>
            {playlist && (
              <>
                <button disabled={!i} onClick={() => move(i, i - 1)}>
                  上へ移動
                </button>
                <button
                  disabled={i === rows.length - 1}
                  onClick={() => move(i, i + 1)}
                >
                  下へ移動
                </button>
                <button
                  onClick={() => {
                    s.updatePlaylist(playlist.id, (p) => {
                      p.entries = p.entries.filter((e) => e.id !== row.id);
                    });
                    notify("曲を削除しました");
                  }}
                >
                  プレイリストから削除
                </button>
              </>
            )}
          </div>
        </details>
      </div>
    );
  };
  return (
    <div className="track-list">
      <div className="list-topline">
        <label>
          <input
            type="checkbox"
            aria-label="表示中の全曲を選択"
            checked={rows.length > 0 && chosen.length === rows.length}
            onChange={(e) =>
              setSelected(
                e.target.checked ? new Set(rows.map((r) => r.id)) : new Set(),
              )
            }
          />{" "}
          {selected.size
            ? `${chosen.length}曲を選択`
            : "タイトル / アーティスト"}
        </label>
        <span>{rows.length}曲</span>
      </div>
      {!!chosen.length && (
        <div className="bulk-toolbar">
          <button
            onClick={() => {
              s.enqueue(bulkTracks);
              notify("キューに追加しました");
            }}
          >
            キューへ追加
          </button>
          <button onClick={() => addTo(bulkTracks)}>プレイリストへ</button>
          <button onClick={() => {
            s.addTracks(bulkTracks);
            notify(`${bulkTracks.length}曲のMP3保存を開始しました`);
            void saveTracks(bulkTracks).then(() => notify('選択したMP3を保存しました')).catch(e => notify(e.message));
          }}>選択した曲を一括保存</button>
          <select
            aria-label="コピー先プレイリスト"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          >
            <option value="">コピー・移動先</option>
            {s.playlists
              .filter((p) => p.id !== playlist?.id)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
          <button disabled={!target} onClick={() => bulk(false)}>
            コピー
          </button>
          {playlist && (
            <>
              <button disabled={!target} onClick={() => bulk(true)}>
                移動
              </button>
              <button
                onClick={() => {
                  s.updatePlaylist(playlist.id, (p) => {
                    p.entries = p.entries.filter((e) => !selected.has(e.id));
                  });
                  setSelected(new Set());
                  notify("選択した曲を削除しました");
                }}
              >
                選択を削除
              </button>
            </>
          )}
        </div>
      )}
      {rows.length > 100 ? (
        <div className="virtual-list" ref={parent}>
          <div style={{ height: virtual.getTotalSize(), position: "relative" }}>
            {virtual.getVirtualItems().map((v) => (
              <div
                key={rows[v.index].id}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${v.start}px)`,
                  height: 80,
                }}
              >
                {render(rows[v.index], v.index)}
              </div>
            ))}
          </div>
        </div>
      ) : (
        rows.map(render)
      )}
    </div>
  );
}
function LibraryView({
  view,
  onCreate,
  openPlaylist,
  navigate,
  importFiles,
  ...props
}: {
  view: View;
  onCreate: () => void;
  openPlaylist: (id: string) => void;
  navigate: (view: View) => void;
  importFiles: () => void;
} & ListProps) {
  const s = useStore(),
    [tab, setTab] = useState("playlists"),
    [filter, setFilter] = useState(""),
    [sort, setSort] = useState("added");
  const tracks = localSearch(Object.values(s.tracks), filter).filter((t) =>
    view === "favorites" || tab === "favorites"
      ? s.favorites.includes(t.id)
      : true,
  );
  if (sort === "title")
    tracks.sort((a, b) => a.title.localeCompare(b.title, "ja"));
  else if (sort === "count")
    tracks.sort((a, b) => (b.playCount || 0) - (a.playCount || 0));
  else tracks.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  const recent = [...new Set(s.history.map((h) => h.trackId))]
    .map((id) => s.tracks[id])
    .filter((t) => normalized(t.title + t.artist).includes(normalized(filter)));
  const title =
    view === "favorites"
      ? "お気に入り"
      : view === "recent"
        ? "最近再生した曲"
        : "マイライブラリ";
  return (
    <>
      <div className="eyebrow">COLLECT WHAT MOVES YOU</div>
      <div className="section-title">
        <h1>{title}</h1>
        <div className="button-row">
          <button className="secondary" onClick={importFiles}>
            <Upload size={16} />
            MP3を読み込む
          </button>
          <button className="primary" onClick={onCreate}>
            <Plus size={17} />
            新規作成
          </button>
        </div>
      </div>
      <div className="library-filters">
        <div className="chips">
          {view === "library" &&
            [
              ["playlists", "プレイリスト"],
              ["tracks", "すべての曲"],
              ["favorites", "お気に入り"],
              ["downloads", "保存管理"],
            ].map(([id, label]) => (
              <button
                key={id}
                className={tab === id ? "active" : ""}
                onClick={() =>
                  id === "downloads" ? navigate("downloads") : setTab(id)
                }
              >
                {label}
              </button>
            ))}
        </div>
        <input
          aria-label="ライブラリ内検索"
          placeholder="ライブラリ内を検索"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <select
          aria-label="曲の並び順"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          <option value="added">最近追加した順</option>
          <option value="title">曲名順</option>
          <option value="count">再生回数順</option>
        </select>
      </div>
      {view === "library" && tab === "playlists" ? (
        <div className="playlist-grid library-grid">
          {s.playlists
            .filter((p) => normalized(p.name).includes(normalized(filter)))
            .map((p, i) => (
              <PlaylistCard
                key={p.id}
                playlist={p}
                index={i}
                onClick={() => openPlaylist(p.id)}
              />
            ))}
          <button className="new-playlist-card" onClick={onCreate}>
            <span>
              <Plus size={28} />
            </span>
            <strong>新しいプレイリスト</strong>
            <small>好きな曲を集めよう</small>
          </button>
        </div>
      ) : (
        <>
          {(view === "recent" ? recent : tracks).length ? (
            <TrackList
              rows={(view === "recent" ? recent : tracks).map((t) => ({
                id: t.id,
                track: t,
              }))}
              {...props}
            />
          ) : (
            <Empty
              icon={view === "favorites" ? Heart : Library}
              title="まだ、まっさらなライブラリ。"
              text="YouTubeから曲を追加するか、手元のMP3を読み込んでみましょう。"
            />
          )}
        </>
      )}
    </>
  );
}
function SettingsPanel({
  health,
  healthError,
  notify,
  refresh,
}: {
  health?: {
    youtubeApi: boolean;
    ai: boolean;
    ffmpeg: boolean;
    downloader: boolean;
    capabilities?: { search: boolean; downloads: boolean; ai: boolean };
  };
  healthError?: string;
  notify: Notify;
  refresh: () => void;
}) {
  const s = useStore(),
    [url, setUrl] = useState(s.settings.apiUrl),
    [token, setToken] = useState(s.settings.token);
  const backupRef = useRef<HTMLInputElement>(null);
  return (
    <div className="settings-content">
      <div className="settings-status">
        <span className={health ? "status-dot connected" : "status-dot"} />
        <div>
          <strong>
            {health
              ? health.capabilities?.downloads === false
                ? "YouTube検索に接続済み"
                : "バックエンド接続済み"
              : "バックエンド未接続"}
          </strong>
          <small>
            {health
              ? health.capabilities?.downloads === false
                ? "検索は利用できます。音源サーバーの公開設定は未完了です。保存済みMP3を再生できます"
                : "YouTube検索・音声取得を利用できます"
              : "保存済みMP3・ライブラリ・コピペ解析を利用できます"}
          </small>
        </div>
      </div>
      <p className="muted small">再生ボタンを押すとMP3を自動で取得・保存します。接続と端末認証は自動で行います。</p>
      <details>
        <summary>開発・診断用の接続設定</summary>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          try {
            if (url) {
              const parsed = new URL(url);
              if (
                !["https:", "http:"].includes(parsed.protocol) ||
                parsed.username ||
                parsed.password
              )
                throw new Error();
              if (
                location.protocol === "https:" &&
                parsed.protocol === "http:" &&
                !["localhost", "127.0.0.1"].includes(parsed.hostname)
              ) {
                notify("HTTPSのAPI URLを指定してください");
                return;
              }
            }
            s.settingsUpdate({ apiUrl: url.replace(/\/$/, ""), token });
            notify("接続設定を保存しました");
            setTimeout(refresh, 0);
          } catch {
            notify("有効なHTTPまたはHTTPSのAPI URLを入力してください");
          }
        }}
      >
        <label>
          バックエンド API URL
          <input
            placeholder="https://your-api.example.com"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </label>
        <label>
          接続トークン
          <input
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        </label>
        <p className="muted small">
          APIキーはサーバー側で設定します。接続トークンはこの端末内に保存されます。
        </p>
        <button className="primary" type="submit">
          保存して接続
        </button>
      </form>
      </details>
      {healthError && <p className="muted small">接続確認: {healthError}</p>}
      {health && (
        <div className="capabilities">
          <span>
            YouTube Data API{" "}
            {health.youtubeApi ? "設定済み" : "未設定（yt-dlpを使用）"}
          </span>
          <span>AI {health.ai ? "設定済み" : "未設定"}</span>
          <span>FFmpeg {health.ffmpeg ? "利用可能" : "見つかりません"}</span>
          <span>
            音声取得 {health.downloader ? "利用可能" : "見つかりません"}
          </span>
        </div>
      )}
      <hr />
      <h3>データと復旧</h3>
      <p className="muted small">
        バックアップには曲・プレイリスト・キューを含みます。MP3本体と接続情報は含みません。
      </p>
      <div className="button-row">
        <button
          onClick={() => {
            const v = snapshot(s);
            v.settings = { ...v.settings, token: "", apiUrl: "" };
            downloadFile(
              JSON.stringify(v, null, 2),
              "musicpleasure-backup.json",
            );
            notify("バックアップを書き出しました");
          }}
        >
          <Download size={17} />
          JSONバックアップ
        </button>
        <button onClick={() => backupRef.current?.click()}>
          <Upload size={17} />
          復元
        </button>
      </div>
      <input
        ref={backupRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={async (e) => {
          try {
            const f = e.target.files?.[0];
            if (!f) return;
            if (f.size > 30 * 1024 ** 2)
              throw new Error("30MB以下のバックアップを選んでください");
            s.restore(JSON.parse(await f.text()));
            notify("バックアップを復元しました。取り消し可能です");
          } catch (err) {
            notify((err as Error).message);
          }
          e.target.value = "";
        }}
      />
      <button
        className="text-button"
        onClick={() =>
          void navigator.storage
            ?.persist?.()
            .then((ok) =>
              notify(
                ok
                  ? "永続保存が許可されました"
                  : "永続保存はブラウザの判断で許可されませんでした",
              ),
            )
        }
      >
        端末の永続保存をリクエスト
      </button>
      <hr />
      <h3>ショートカット</h3>
      <p className="muted small">
        Space: 再生・停止 / Ctrl+K: 検索 / Alt+← →: 曲送り / Ctrl+Z: 取り消し
      </p>
      <p className="muted small">
        PWAのインストールはブラウザメニューから「ホーム画面に追加」または「アプリをインストール」。
      </p>
    </div>
  );
}
function Downloads({ notify }: { notify: Notify }) {
  const s = useStore(),
    playback = usePlayback(),
    [assets, setAssets] = useState<{ id: string; bytes: number }[]>([]),
    [estimate, setEstimate] = useState<StorageEstimate | undefined>();
  const list = useQuery({
    queryKey: ["jobs", s.settings.apiUrl, s.settings.token],
    queryFn: jobs,
    refetchInterval: 3000,
    retry: false,
  });
  const storage = useQuery({
    queryKey: ["storage", s.settings.apiUrl, s.settings.token],
    queryFn: () =>
      api<{
        used: number;
        limit: number;
        quotaSpent: number;
        quotaBudget: number;
      }>("/storage"),
    refetchInterval: 10000,
    retry: false,
  });
  useEffect(() => {
    void db.assets
      .toArray()
      .then(setAssets)
      .catch(() => {});
    void navigator.storage?.estimate?.().then(setEstimate);
  }, [playback.cacheRevision]);
  const titles = (id: string) =>
    Object.values(s.tracks).find((t) => t.sources.some((a) => a.id === id || sourceKey(a) === id))
      ?.title || id;
  return (
    <>
      <div className="eyebrow">READY WHEN YOU ARE</div>
      <h1>ダウンロードと保存</h1>
      <div className="storage-cards">
        <div className="surface">
          <ArrowDownToLine />
          <h2>{bytes(assets.reduce((n, a) => n + a.bytes, 0))}</h2>
          <p>端末内のMP3 · {assets.length}曲</p>
          <small>
            {estimate?.quota
              ? `ブラウザ割り当て上限 ${bytes(estimate.quota)}`
              : "容量を確認しています"}
          </small>
        </div>
        <div className="surface">
          <Disc3 />
          <h2>{storage.data ? bytes(storage.data.used) : "—"}</h2>
          <p>サーバー保存容量</p>
          <small>
            {storage.data
              ? `上限 ${bytes(storage.data.limit)} · API ${storage.data.quotaSpent}/${storage.data.quotaBudget}`
              : "バックエンド接続後に表示"}
          </small>
        </div>
      </div>
      <h2 className="list-heading">音声取得ジョブ</h2>
      {list.error && <p className="error-box">{list.error.message}</p>}
      {list.data?.map((j) => (
        <div className="download-row" key={j.id}>
          <Download size={20} />
          <div>
            <strong>{titles(`youtube:${j.videoId}`)}</strong>
            <small>
              {
                {
                  queued: "待機中",
                  downloading: "取得中",
                  converting: "MP3へ変換中",
                  ready: "サーバー保存済み",
                  failed: "失敗",
                  cancelled: "キャンセル済み",
                }[j.state]
              }{" "}
              {j.state === "downloading" && j.progress !== null ? ` · ${j.progress.toFixed(0)}%` : ""} · {j.attempt}/3回
            </small>
            {j.error && <p className="error small">{j.error}</p>}
            {!["ready", "failed", "cancelled"].includes(j.state) && (
              <progress aria-label="音源取得の進捗" max="100" value={j.state === "downloading" && j.progress !== null ? j.progress : undefined} />
            )}
          </div>
          {["failed", "cancelled"].includes(j.state) ? (
            <button
              onClick={() =>
                void api("/jobs", {
                  method: "POST",
                  body: JSON.stringify({ videoId: j.videoId }),
                })
                  .then(() => list.refetch())
                  .catch((e) => notify(e.message))
              }
            >
              再試行
            </button>
          ) : (
            j.state !== "ready" && (
              <button
                onClick={() =>
                  void api(`/jobs/${j.id}/cancel`, { method: "POST" })
                    .then(() => list.refetch())
                    .catch((e) => notify(e.message))
                }
              >
                中止
              </button>
            )
          )}
          <IconButton
            icon={Trash2}
            label="サーバー音源・ジョブを削除"
            onClick={() => {
              if (!confirm("このサーバー音源・ジョブを削除しますか？端末内MP3は保持されます")) return;
              void api(`/jobs/${j.id}`, { method: "DELETE" })
                .then(() => list.refetch())
                .catch((e) => notify(e.message));
            }}
          />
        </div>
      ))}
      {!list.data?.length && !list.isPending && (
        <p className="muted">取得中のジョブはありません。</p>
      )}
      <h2 className="list-heading">この端末に保存したMP3</h2>
      <button onClick={() => {
        const referenced = new Set(Object.values(s.tracks).flatMap(t => t.sources.flatMap(source => [source.id, sourceKey(source)])));
        const unused = assets.filter(a => !referenced.has(a.id));
        if (!unused.length) { notify('不要な音源はありません'); return; }
        if (!confirm(`ライブラリから参照されていない${unused.length}曲のMP3を削除しますか？`)) return;
        void db.assets.bulkDelete(unused.map(a => a.id)).then(() => {
          usePlayback.setState(v => ({cacheRevision:v.cacheRevision + 1}));
          notify('不要な音源を整理しました');
        }).catch(() => notify('音源を削除できませんでした'));
      }}>不要音源を整理</button>
      {assets.map((a) => (
        <div className="download-row" key={a.id}>
          <Music2 size={20} />
          <div>
            <strong>{titles(a.id)}</strong>
            <small>{bytes(a.bytes)} · オフライン再生可能</small>
          </div>
          <IconButton
            icon={Trash2}
            label={`${titles(a.id)}の端末内MP3を削除`}
            onClick={() => {
              if (!confirm(`${titles(a.id)}の端末内MP3を削除しますか？再生には再取得が必要です`)) return;
              void db.assets.delete(a.id).then(() => {
                usePlayback.setState((v) => ({
                  cacheRevision: v.cacheRevision + 1,
                }));
                notify(
                  "端末内のMP3を削除しました。ライブラリの曲情報は保持されます",
                );
              }).catch(() => notify('音源を削除できませんでした'));
            }}
          />
        </div>
      ))}
      {!assets.length && (
        <Empty
          icon={Download}
          title="好きな曲を、いつでも。"
          text="曲を再生するとMP3を自動保存します。次回からオフラインでも聴けます。"
        />
      )}
    </>
  );
}
function downloadFile(text: string, name: string) {
  const url = URL.createObjectURL(
    new Blob([text], { type: "application/json;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
