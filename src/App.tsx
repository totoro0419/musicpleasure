import { useEffect, useRef, useState } from "react";
import {
  AudioLines,
  Home,
  Search as SearchIcon,
  Library as LibraryIcon,
  Radio as RadioIcon,
  Sparkles,
  Settings as SettingsIcon,
  Download,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Shuffle,
  Repeat,
  Repeat1,
  Heart,
  ListMusic,
  Volume2,
  Undo2,
  Redo2,
  ChevronRight,
  Music2,
  WifiOff,
  X,
  Plus,
} from "lucide-react";
import { store, useStore } from "./lib/store";
import { player } from "./lib/player";
import { move, time } from "./lib/model";
import { Search } from "./components/Search";
import { Library, PlaylistCard } from "./components/Library";
import { Radio, modeLabels } from "./components/Radio";
import { ImportPanel } from "./components/ImportPanel";
import { Settings } from "./components/Settings";
import { TrackList } from "./components/TrackList";
interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
}
const nav = [
  { id: "home", label: "ホーム", icon: Home },
  { id: "search", label: "検索", icon: SearchIcon },
  { id: "library", label: "ライブラリ", icon: LibraryIcon },
  { id: "radio", label: "無限ラジオ", icon: RadioIcon },
  { id: "import", label: "AI一括登録", icon: Sparkles },
];
function HomePage({ onAdd }: { onAdd: (ids: string[]) => void }) {
  const { data } = useStore();
  return (
    <>
      <div className="home-greeting">
        <span>YOUR EVERYDAY SOUNDTRACK</span>
        <span className="quiet-pill">
          <span className="dot" />
          あなたの音楽、ひとつに。
        </span>
      </div>
      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow">
            <AudioLines size={17} /> MUSIC WITHOUT LIMITS
          </div>
          <h1>
            次の一曲に、
            <br />
            <span>出会おう。</span>
          </h1>
          <p>
            お気に入りの曲も、まだ知らない歌い手も。
            <br />
            好きな音が、ずっとつながる。
          </p>
          <div className="actions">
            <a href="#search" className="primary button">
              <SearchIcon size={19} />
              音楽を探す
            </a>
            <a href="#radio" className="button ghost">
              <RadioIcon size={19} />
              ラジオを始める
            </a>
          </div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="record">
            <div className="record-label">
              <AudioLines size={42} />
              <span>MP / 02</span>
            </div>
          </div>
          <div className="art-caption">
            FIND YOUR
            <br />
            NEXT FAVORITE.
          </div>
          <div className="wave">
            {Array.from({ length: 30 }, (_, i) => (
              <i key={i} style={{ height: 8 + (Math.sin(i * 1.7) + 1) * 17 }} />
            ))}
          </div>
        </div>
      </section>
      <div className="quick-links">
        <a href="#import">
          <span className="quick-icon purple">
            <Sparkles />
          </span>
          <div>
            <b>曲一覧を、まとめて登録</b>
            <span>ChatGPTのリストを貼り付けるだけ</span>
          </div>
          <ChevronRight size={19} />
        </a>
        <a href="#radio">
          <span className="quick-icon cyan">
            <RadioIcon />
          </span>
          <div>
            <b>好きから広がる、無限ラジオ</b>
            <span>歌ってみたも、新しい出会いも</span>
          </div>
          <ChevronRight size={19} />
        </a>
      </div>
      <div className="section-heading">
        <div>
          <span className="eyebrow">MADE BY YOU</span>
          <h2>あなたのプレイリスト</h2>
        </div>
        <a href="#library">
          すべて見る <ChevronRight size={15} />
        </a>
      </div>
      <div className="playlist-grid">
        {data.playlists.slice(0, 5).map((p) => (
          <PlaylistCard id={p.id} key={p.id} />
        ))}
        <a className="create-card" href="#library">
          <span>
            <Plus size={30} />
          </span>
          <b>新しいプレイリスト</b>
          <small>好きな曲を集めよう</small>
        </a>
      </div>
      <div className="section-heading">
        <div>
          <span className="eyebrow">BACK TO YOUR FAVORITES</span>
          <h2>最近聴いた曲</h2>
        </div>
        <a href="#library">
          ライブラリへ <ChevronRight size={15} />
        </a>
      </div>
      {data.history.length ? (
        <TrackList
          tracks={data.history
            .slice(0, 6)
            .map((id) => data.tracks[id])
            .filter(Boolean)}
          onAdd={onAdd}
        />
      ) : (
        <div className="history-empty">
          <AudioLines size={24} />
          <p>
            再生した曲がここに並びます。
            <span>まずは、今聴きたい一曲を見つけよう。</span>
          </p>
          <a className="button" href="#search">
            曲を検索
          </a>
        </div>
      )}
      <div className="section-heading">
        <div>
          <span className="eyebrow">EXPLORE MORE</span>
          <h2>気分から、見つける。</h2>
        </div>
      </div>
      <div className="mood-grid">
        {[
          ["01", "歌ってみた", "COVER VOICES", "violet"],
          ["02", "新しい音楽", "FRESH FINDS", "blue"],
          ["03", "お気に入りに浸る", "ON REPEAT", "teal"],
        ].map(([n, title, sub, color]) => (
          <a
            key={n}
            href={n === "03" ? "#library" : "#search"}
            className={`mood-card ${color}`}
          >
            <small>{n} / MUSICPLEASURE</small>
            <h3>{title}</h3>
            <span>{sub} ↗</span>
            <AudioLines size={80} />
          </a>
        ))}
      </div>
    </>
  );
}
function NowPlaying({ onAdd }: { onAdd: (ids: string[]) => void }) {
  const { data, playback } = useStore();
  const t = data.tracks[data.queue[data.current]];
  return (
    <>
      <div className="page-intro">
        <div className="eyebrow">NOW PLAYING</div>
        <h1>いま、聴いている音。</h1>
      </div>
      {t ? (
        <>
          <section className="nowplaying">
            <img className="album" src={t.thumbnail} alt="" />
            <div>
              <span className="eyebrow">INVIDIOUS AUDIO</span>
              <h2>{t.title}</h2>
              <p>{t.uploader}</p>
              <p className="muted">
                {modeLabels[data.settings.radioMode]} · ラジオ{" "}
                {data.radio ? "ON" : "OFF"}
              </p>
              <div className="actions">
                <button className="primary" onClick={() => store.toggle()}>
                  {playback.status === "playing" ? <Pause /> : <Play />}
                  {playback.status === "playing" ? "一時停止" : "再生"}
                </button>
                <button onClick={() => void store.startRadio(t)}>
                  <RadioIcon size={18} />
                  この曲からラジオ
                </button>
                <button
                  aria-pressed={data.shuffle}
                  onClick={() => store.shuffle()}
                >
                  <Shuffle size={18} />
                  シャッフル {data.shuffle ? "ON" : "OFF"}
                </button>
                <button
                  onClick={() =>
                    store.update((d) => ({
                      ...d,
                      repeat:
                        d.repeat === "off"
                          ? "all"
                          : d.repeat === "all"
                            ? "one"
                            : "off",
                    }))
                  }
                >
                  <Repeat size={18} />
                  リピート{" "}
                  {data.repeat === "off"
                    ? "なし"
                    : data.repeat === "all"
                      ? "全曲"
                      : "1曲"}
                </button>
              </div>
              <label className="full-volume">
                音量
                <input
                  aria-label="再生画面の音量"
                  type="range"
                  min="0"
                  max="1"
                  step=".01"
                  defaultValue={player.audio.volume}
                  onChange={(e) => player.volume(Number(e.target.value))}
                />
              </label>
            </div>
          </section>
          <TrackList
            tracks={data.queue
              .slice(data.current + 1)
              .map((id) => data.tracks[id])
              .filter(Boolean)}
            onAdd={onAdd}
          />
        </>
      ) : (
        <div className="empty">
          曲を選ぶと、ここに表示されます。<a href="#search">音楽を探す</a>
        </div>
      )}
    </>
  );
}
export default function App() {
  const { data, playback, notice, loaded } = useStore();
  const [route, setRoute] = useState(location.hash.slice(1) || "home");
  const [online, setOnline] = useState(navigator.onLine);
  const [install, setInstall] = useState<InstallPrompt | null>(null);
  const [update, setUpdate] = useState<ServiceWorker | null>(null);
  const [volume, setVolume] = useState(0.8);
  const [addIds, setAddIds] = useState<string[]>([]);
  const [target, setTarget] = useState("");
  const [newName, setNewName] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    void store.init();
    const hash = () => {
      setRoute(location.hash.slice(1) || "home");
      window.scrollTo(0, 0);
    };
    const on = () => setOnline(true),
      off = () => setOnline(false);
    const prompt = (e: Event) => {
      e.preventDefault();
      setInstall(e as InstallPrompt);
    };
    window.addEventListener("hashchange", hash);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    window.addEventListener("beforeinstallprompt", prompt);
    if ("serviceWorker" in navigator)
      void navigator.serviceWorker
        .register(`${import.meta.env.BASE_URL}sw.js`)
        .then((reg) => {
          if (reg.waiting) setUpdate(reg.waiting);
          reg.addEventListener("updatefound", () => {
            const worker = reg.installing;
            worker?.addEventListener("statechange", () => {
              if (
                worker.state === "installed" &&
                navigator.serviceWorker.controller
              )
                setUpdate(worker);
            });
          });
        })
        .catch(() =>
          store.notify(
            "オフライン機能を準備できませんでした。オンラインでは引き続き利用できます。",
          ),
        );
    return () => {
      window.removeEventListener("hashchange", hash);
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      window.removeEventListener("beforeinstallprompt", prompt);
    };
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = data.settings.theme;
  }, [data.settings.theme]);
  function onAdd(ids: string[]) {
    setAddIds(ids);
    setTarget(data.playlists[0]?.id || "");
    dialog.current?.showModal();
  }
  async function doInstall() {
    if (install) {
      await install.prompt();
      await install.userChoice;
      setInstall(null);
    } else
      store.notify(
        "Chrome / Edgeのメニューから「アプリをインストール」または「ホーム画面に追加」を選んでください。",
      );
  }
  function applyUpdate() {
    if (!update) return;
    void store.flush().then(() => {
      navigator.serviceWorker.addEventListener(
        "controllerchange",
        () => location.reload(),
        { once: true },
      );
      update.postMessage("SKIP_WAITING");
    });
  }
  const current = data.tracks[data.queue[data.current]];
  const active = route.split("/")[0];
  const repeatIcon = data.repeat === "one" ? Repeat1 : Repeat;
  const RepeatIcon = repeatIcon;
  const isPlaying = playback.status === "playing";
  const statusLabel = {
    idle: "再生待ち",
    loading: "準備中",
    playing: "再生中",
    paused: "一時停止",
    blocked: "再開操作が必要",
    error: "再生できません",
    ended: "再生終了",
  }[playback.status];
  return (
    <div className="app">
      <a className="skip-link" href="#main-content">
        本文へ移動
      </a>
      <aside className="sidebar">
        <a className="brand" href="#home">
          <span>
            <AudioLines size={25} />
          </span>
          <div>
            MusicPleasure<small>FIND YOUR NEXT FAVORITE</small>
          </div>
        </a>
        <div className="nav-caption">DISCOVER</div>
        <nav aria-label="メインナビゲーション">
          {nav.map((n) => (
            <a
              key={n.id}
              className={
                active === n.id || (n.id === "library" && active === "playlist")
                  ? "active"
                  : ""
              }
              href={`#${n.id}`}
              aria-current={active === n.id ? "page" : undefined}
            >
              <n.icon size={21} />
              <span>{n.label}</span>
              {n.id === "import" && <small>NEW</small>}
            </a>
          ))}
        </nav>
        <div className="nav-caption collection-caption">
          YOUR COLLECTION{" "}
          <a href="#library" aria-label="プレイリスト作成">
            <Plus size={17} />
          </a>
        </div>
        <div className="sidebar-playlists">
          {data.playlists.slice(0, 8).map((p) => (
            <a key={p.id} href={`#playlist/${p.id}`}>
              <ListMusic size={17} />
              <span>{p.name}</span>
            </a>
          ))}
          {!data.playlists.length && (
            <span>
              好きな曲を集めて、
              <br />
              あなただけのプレイリストに。
            </span>
          )}
        </div>
        <div className="sidebar-bottom">
          <div className="local-card">
            <span className="dot" />
            <b>あなたの音楽は、あなたの手元に。</b>
            <p>
              ログイン不要。ライブラリは
              <br />
              この端末に保存されます。
            </p>
          </div>
          <a href="#settings" className={active === "settings" ? "active" : ""}>
            <SettingsIcon size={20} />
            設定
          </a>
          <button onClick={() => void doInstall()}>
            <Download size={19} />
            アプリをインストール
          </button>
          <span className="version">MUSICPLEASURE / V2.0</span>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <span className="breadcrumb">
            MusicPleasure <ChevronRight size={14} />
            <b>
              {nav.find((n) => n.id === active)?.label ||
                (active === "settings"
                  ? "設定"
                  : active === "queue"
                    ? "再生キュー"
                    : active === "playing"
                      ? "再生中"
                      : "プレイリスト")}
            </b>
          </span>
          <div className="topbar-actions">
            <button
              className="icon"
              disabled={!store.canUndo}
              aria-label="元に戻す"
              onClick={() => store.undo()}
            >
              <Undo2 size={19} />
            </button>
            <button
              className="icon"
              disabled={!store.canRedo}
              aria-label="やり直す"
              onClick={() => store.redo()}
            >
              <Redo2 size={19} />
            </button>
            <span className="profile-mark">MP</span>
          </div>
        </header>
        {!online && (
          <div className="offline">
            <WifiOff size={17} />
            オフラインです。保存したライブラリを閲覧できます。
          </div>
        )}
        {update && (
          <div className="update-banner">
            新しいバージョンを利用できます。
            <button onClick={applyUpdate}>更新する</button>
          </div>
        )}
        {notice && (
          <div className="notice" role="status">
            <span>{notice}</span>
            <button
              className="icon"
              aria-label="通知を閉じる"
              onClick={() => store.notify("")}
            >
              <X size={17} />
            </button>
          </div>
        )}
        <main id="main-content" className="content">
          {!loaded ? (
            <div className="loading">ライブラリを開いています…</div>
          ) : active === "search" ? (
            <Search onAdd={onAdd} />
          ) : active === "library" || active === "playlist" ? (
            <Library key={route} id={route.split("/")[1]} onAdd={onAdd} />
          ) : active === "radio" ? (
            <Radio onAdd={onAdd} />
          ) : active === "import" ? (
            <ImportPanel />
          ) : active === "settings" ? (
            <Settings
              onInstall={() => void doInstall()}
              updateAvailable={!!update}
              onUpdate={applyUpdate}
            />
          ) : active === "queue" ? (
            <>
              <div className="page-intro">
                <span className="eyebrow">UP NEXT</span>
                <h1>再生キュー</h1>
                <p>
                  {data.queue.length}曲 · 曲順を編集しても再生位置は保たれます。
                </p>
              </div>
              <div className="actions">
                <button
                  disabled={!data.queue.length}
                  onClick={() => {
                    store.create("保存したキュー", data.queue);
                    store.notify("再生キューをプレイリストに保存しました");
                  }}
                >
                  キューを保存
                </button>
                <button
                  onClick={() => {
                    player.stop();
                    store.update((d) => ({
                      ...d,
                      queue: [],
                      current: -1,
                      position: 0,
                      radio: false,
                    }));
                  }}
                >
                  キューを空にする
                </button>
              </div>
              <TrackList
                tracks={data.queue.map((id) => data.tracks[id]).filter(Boolean)}
                onAdd={onAdd}
                queue
                reorder={(from, to) =>
                  store.update((d) => {
                    const q = move(d.queue, from, to);
                    const current =
                      from === d.current
                        ? to
                        : from < d.current && to >= d.current
                          ? d.current - 1
                          : from > d.current && to <= d.current
                            ? d.current + 1
                            : d.current;
                    return { ...d, queue: q, current };
                  })
                }
                onRemove={(i) => store.removeQueue(i)}
              />
            </>
          ) : active === "playing" ? (
            <NowPlaying onAdd={onAdd} />
          ) : (
            <HomePage onAdd={onAdd} />
          )}
        </main>
        <footer className="page-footer">
          <AudioLines size={16} />
          MusicPleasure<span>あなたの毎日に、好きな音を。</span>
        </footer>
      </div>
      <section className="playerbar" aria-label="音楽プレーヤー">
        <a className="mini-track" href="#playing">
          {current ? (
            <img src={current.thumbnail} alt="" />
          ) : (
            <span className="mini-placeholder">
              <Music2 size={25} />
            </span>
          )}
          <div>
            <b>{current?.title || "あなたの音楽を、ここから。"}</b>
            <span>
              {current?.uploader || "曲を選んで再生しよう"}
              {current && <small> · {statusLabel}</small>}
            </span>
          </div>
        </a>
        <button
          className={`icon mini-heart ${current && data.favorites.includes(current.id) ? "selected" : ""}`}
          disabled={!current}
          aria-label="再生曲をお気に入り"
          onClick={() => current && store.favorite(current.id)}
        >
          <Heart
            size={19}
            fill={
              current && data.favorites.includes(current.id)
                ? "currentColor"
                : "none"
            }
          />
        </button>
        <div className="transport">
          <div className="transport-buttons">
            <button
              className={`icon shuffle ${data.shuffle ? "selected" : ""}`}
              aria-pressed={data.shuffle}
              aria-label="シャッフル"
              onClick={() => store.shuffle()}
            >
              <Shuffle size={18} />
            </button>
            <button
              className="icon"
              aria-label="前の曲"
              disabled={!current}
              onClick={() => store.previous()}
            >
              <SkipBack size={21} fill="currentColor" />
            </button>
            <button
              className="play-toggle"
              aria-label={
                isPlaying
                  ? "一時停止"
                  : playback.status === "loading"
                    ? "読み込みを中止"
                    : "再生"
              }
              disabled={!current}
              onClick={() => store.toggle()}
            >
              {isPlaying ? (
                <Pause size={23} fill="currentColor" />
              ) : playback.status === "loading" ? (
                <X size={22} />
              ) : (
                <Play size={23} fill="currentColor" />
              )}
            </button>
            <button
              className="icon"
              aria-label="次の曲"
              disabled={!current}
              onClick={() => store.next()}
            >
              <SkipForward size={21} fill="currentColor" />
            </button>
            <button
              className={`icon repeat ${data.repeat !== "off" ? "selected" : ""}`}
              aria-label={`リピート：${data.repeat}`}
              onClick={() =>
                store.update((d) => ({
                  ...d,
                  repeat:
                    d.repeat === "off"
                      ? "all"
                      : d.repeat === "all"
                        ? "one"
                        : "off",
                }))
              }
            >
              <RepeatIcon size={18} />
            </button>
          </div>
          <div className="seek">
            <span>
              {time(playback.engine ? playback.position : data.position)}
            </span>
            <input
              aria-label="再生位置"
              type="range"
              min="0"
              max={playback.duration || current?.duration || 1}
              step="1"
              value={Math.min(
                playback.duration || current?.duration || 1,
                playback.engine ? playback.position : data.position,
              )}
              onChange={(e) => player.seek(Number(e.target.value))}
              disabled={!current}
            />
            <span>{time(playback.duration || current?.duration || 0)}</span>
          </div>
        </div>
        <div className="player-options">
          <a href="#queue" className="icon" aria-label="再生キュー">
            <ListMusic size={21} />
            <small>{data.queue.length || ""}</small>
          </a>
          <Volume2 size={18} />
          <input
            aria-label="音量"
            type="range"
            min="0"
            max="1"
            step=".01"
            value={volume}
            onChange={(e) => {
              const v = Number(e.target.value);
              setVolume(v);
              player.volume(v);
            }}
          />
          <span className="engine-badge">
            {playback.engine === "invidious" ? "Invidious" : "AUDIO"}
          </span>
        </div>
        {(playback.message ||
          playback.status === "error" ||
          playback.status === "blocked") && (
          <div
            className={`player-message ${playback.status === "error" ? "error" : ""}`}
            role="status"
          >
            <span>{playback.message}</span>
            {(playback.status === "error" || playback.status === "blocked") && (
              <button onClick={() => void store.playCurrent(playback.position)}>
                再試行 / 再開
              </button>
            )}
          </div>
        )}
      </section>
      <nav className="mobile-nav" aria-label="モバイルナビゲーション">
        {nav.slice(0, 4).map((n) => (
          <a
            className={active === n.id ? "active" : ""}
            key={n.id}
            href={`#${n.id}`}
          >
            <n.icon size={21} />
            <span>{n.label}</span>
          </a>
        ))}
        <a href="#import" className={active === "import" ? "active" : ""}>
          <Sparkles size={21} />
          <span>一括登録</span>
        </a>
      </nav>
      <dialog ref={dialog} onCancel={() => setAddIds([])}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            let id = target;
            if (!id) id = store.create(newName || "新しいプレイリスト");
            store.addToPlaylist(id, addIds);
            dialog.current?.close();
          }}
        >
          <div className="section-heading">
            <h2>プレイリストに追加</h2>
            <button
              type="button"
              className="icon"
              aria-label="閉じる"
              onClick={() => dialog.current?.close()}
            >
              <X />
            </button>
          </div>
          <p>{addIds.length}曲を追加します。</p>
          <label>
            追加先
            <select value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">新しいプレイリスト</option>
              {data.playlists.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          {!target && (
            <label>
              プレイリスト名
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </label>
          )}
          <button className="primary" type="submit">
            追加する
          </button>
        </form>
      </dialog>
    </div>
  );
}
