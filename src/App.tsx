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
import { Settings } from "./components/Settings";
import { TrackList } from "./components/TrackList";
interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
}
const nav = [
  { id: "home", label: "ホーム", icon: Home },
  { id: "search", label: "探す", icon: SearchIcon },
  { id: "library", label: "ライブラリ", icon: LibraryIcon },
  { id: "radio", label: "ラジオ", icon: RadioIcon },
];
function HomePage({ onAdd }: { onAdd: (ids: string[]) => void }) {
  const { data } = useStore();
  const recent = data.history
    .slice(0, 6)
    .map((id) => data.tracks[id])
    .filter(Boolean);
  return (
    <div className="home-dashboard">
      <section className="home-welcome" aria-labelledby="home-title">
        <span className="home-kicker"><img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" width="28" height="28" /> MUSICPLEASURE <span className="home-kicker-dot">●</span> DISCOVER YOUR SOUND</span>
        <h1 id="home-title">次の一曲に、出会おう。</h1>
        <p>聴きたい曲を検索して、好きな曲だけを再生。
          <br />プレイリストも、ここからすぐに開けます。</p>
        <div className="home-primary-actions">
          <a className="button primary" href="#search"><SearchIcon size={20} /> 曲を検索する <ChevronRight size={18}/></a>
          <a className="button home-secondary" href="#library"><LibraryIcon size={20} /> プレイリストを見る</a>
        </div>
        <div className="hero-visual" aria-hidden="true">
          <div className="hero-halo hero-halo-outer" />
          <div className="hero-halo hero-halo-inner" />
          <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" width="180" height="180" />
        </div>
      </section>
      <nav className="home-shortcuts" aria-label="よく使う操作">
        <a href="#radio">
          <span className="shortcut-symbol shortcut-radio"><RadioIcon size={22}/></span>
          <span><b>無限ラジオ</b><small>好みの曲から自動で再生</small></span>
          <ChevronRight size={18}/>
        </a>
        <a href="#import">
          <span className="shortcut-symbol shortcut-import"><Sparkles size={22}/></span>
          <span><b>曲を追加</b><small>曲名やURLをまとめて貼り付ける</small></span>
          <ChevronRight size={18}/>
        </a>
      </nav>
      <section className="home-section" aria-labelledby="recent-title">
        <div className="home-section-head">
          <div><h2 id="recent-title">最近聴いた曲</h2><p>続きを聴きたい曲をすぐに再生</p></div>
          <a href="#library">ライブラリへ <ChevronRight size={17}/></a>
        </div>
        {recent.length ? (
          <TrackList tracks={recent} onAdd={onAdd} singlePlay />
        ) : (
          <div className="home-empty">
            <span className="home-empty-icon"><Music2 size={26}/></span>
            <div><b>再生した曲がここに表示されます</b><p>まずは好きな曲を探してみましょう。</p></div>
            <a className="button" href="#search">曲を探す <ChevronRight size={16}/></a>
          </div>
        )}
      </section>
      <section className="home-section" aria-labelledby="playlists-title">
        <div className="home-section-head">
          <div><h2 id="playlists-title">マイプレイリスト</h2><p>自分で保存した曲のコレクション</p></div>
          <a href="#library">すべて見る <ChevronRight size={17}/></a>
        </div>
        <div className="playlist-grid">
          {data.playlists.slice(0, 5).map((p) => <PlaylistCard id={p.id} key={p.id}/>)}
          <a className="create-card" href="#library">
            <span><Plus size={26}/></span>
            <b>プレイリストを作る</b>
            <small>曲をまとめて保存</small>
          </a>
        </div>
      </section>
    </div>
  );
}
function NowPlaying({ onAdd }: { onAdd: (ids: string[]) => void }) {
  const { data, playback } = useStore();
  const t = data.tracks[data.queue[data.current]];
  return (
    <>
      <div className="page-intro">
        <div className="eyebrow">再生中</div>
        <h1>いま聴いている曲</h1>
      </div>
      {t ? (
        <>
          <section className="nowplaying">
            {t.thumbnail ? <img className="album" src={t.thumbnail} alt="" /> : <div className="album local-art"><Music2 size={72} /></div>}
            <div>
              <span className="eyebrow">再生中</span>
              <h2>{t.title}</h2>
              <p>{t.uploader}</p>
              <p className="muted">
                {data.radio ? `${modeLabels[data.settings.radioMode]}でラジオ再生中` : t.source === "local" ? "オフライン音楽" : "オンライン再生"}
              </p>
              <div className="actions">
                <button onClick={() => store.previous()}><SkipBack size={18} />前の曲</button>
                <button className="primary" onClick={() => store.toggle()}>
                  {playback.status === "playing" ? <Pause /> : <Play />}
                  {playback.status === "playing" ? "一時停止" : "再生"}
                </button>
                <button onClick={() => store.next()}><SkipForward size={18} />次の曲</button>
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
              <label>再生位置 · {time(playback.position)} / {time(playback.duration || t.duration)}
                <input aria-label="再生画面の再生位置" type="range" min="0" max={playback.duration || t.duration || 1} step="1" value={Math.min(playback.position, playback.duration || t.duration || 1)} onChange={e => player.seek(Number(e.target.value))} />
              </label>
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
          <div className="home-section-head"><div><h2>次に再生</h2><p>タップするとその曲に切り替わります</p></div><a href="#queue">キューを見る <ChevronRight size={17}/></a></div>
          <TrackList
            queue
            queueOffset={data.current + 1}
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
  const [showClearQueue, setShowClearQueue] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [install, setInstall] = useState<InstallPrompt | null>(null);
  const [update, setUpdate] = useState<ServiceWorker | null>(null);
  const [volume, setVolume] = useState(0.8);
  const [miniPlayerHidden, setMiniPlayerHidden] = useState(() => {
    try {
      return window.localStorage.getItem("musicpleasure-mini-player-hidden") === "true";
    } catch {
      return false;
    }
  });
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
  useEffect(() => {
    try {
      window.localStorage.setItem(
        "musicpleasure-mini-player-hidden",
        String(miniPlayerHidden),
      );
    } catch {
      // Storage can be blocked; the control still works in this session.
    }
  }, [miniPlayerHidden]);
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
  const navigationActive = ["local", "import", "playlist"].includes(active) ? "library" : active;
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
    <div className={`app${miniPlayerHidden ? " player-hidden" : ""}`}>
      <a className="skip-link" href="#main-content">
        本文へ移動
      </a>
      <aside className="sidebar">
        <a className="brand" href="#home" aria-label="MusicPleasure ホーム">
          <span className="brand-mark">
            <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" width="46" height="46" />
          </span>
          <div className="brand-wordmark">
            Music<span>Pleasure</span><small>YOUR SOUND, YOUR SPACE</small>
          </div>
        </a>
        <div className="nav-caption">メニュー</div>
        <nav aria-label="メインナビゲーション">
          {nav.map((n) => (
            <a
              key={n.id}
              className={
                navigationActive === n.id
                  ? "active"
                  : ""
              }
              href={`#${n.id}`}
              aria-current={navigationActive === n.id ? "page" : undefined}
            >
              <n.icon size={21} />
              <span>{n.label}</span>
              
            </a>
          ))}
        </nav>
        <div className="nav-caption collection-caption">
          プレイリスト{" "}
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
          <span className="version">MusicPleasure / Invidious</span>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <span className="breadcrumb">
            <b>
              {nav.find((n) => n.id === navigationActive)?.label ||
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
            <a className="topbar-search" href="#search" aria-label="曲を検索する"><SearchIcon size={18}/><span>曲を検索</span></a>
            {(store.canUndo || store.canRedo) && (
              <>
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
              </>
            )}
            <a href="#settings" className="icon topbar-settings" aria-label="設定"><SettingsIcon size={21}/></a>
          </div>
        </header>
        {!online && (
          <div className="offline">
            <WifiOff size={17} />
            オフラインです。保存した音声を再生できます。<a href="#local">保存した音楽へ</a>
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
          ) : ["library", "playlist", "local", "import"].includes(active) ? (
            <Library
              key={route}
              id={active === "playlist" ? route.split("/")[1] : undefined}
              initialTab={active === "local" ? "local" : active === "import" ? "import" : "playlists"}
              onAdd={onAdd}
            />
          ) : active === "radio" ? (
            <Radio onAdd={onAdd} />
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
                  disabled={!data.queue.length}
                  onClick={() => setShowClearQueue(true)}
                >
                  キューを空にする
                </button>
                {showClearQueue && (
                  <div className="confirmation" role="group" aria-label="再生キュー削除の確認">
                    <p>再生を停止して、キューの{data.queue.length}曲をすべて消しますか？ プレイリストは残ります。</p>
                    <button className="danger" onClick={() => {
                      player.stop();
                      store.update((d) => ({
                        ...d,
                        queue: [],
                        current: -1,
                        position: 0,
                        radio: false,
                      }));
                      setShowClearQueue(false);
                    }}>削除を確定</button>
                    <button onClick={() => setShowClearQueue(false)}>キャンセル</button>
                  </div>
                )}
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
      {miniPlayerHidden ? (
        <button
          type="button"
          className="player-restore"
          aria-label="ミニプレーヤーを再表示"
          onClick={() => setMiniPlayerHidden(false)}
        >
          <Music2 size={19} />
          <span>プレーヤーを表示</span>
        </button>
      ) : (
      <section className="playerbar" aria-label="音楽プレーヤー">
        <button
          type="button"
          className="player-dismiss"
          aria-label="ミニプレーヤーを閉じる"
          title="ミニプレーヤーを閉じる（再生は継続）"
          onClick={() => setMiniPlayerHidden(true)}
        >
          <X size={18} />
        </button>
        <a className="mini-track" data-track-id={current?.id || ""} href="#playing">
          {current?.thumbnail ? (
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
      )}
      <nav className="mobile-nav" aria-label="モバイルナビゲーション">
        {nav.filter(n => ["home", "search", "library", "radio"].includes(n.id)).map((n) => (
          <a
            className={navigationActive === n.id ? "active" : ""}
            key={n.id}
            href={`#${n.id}`}
          >
            <n.icon size={21} />
            <span>{n.label}</span>
          </a>
        ))}

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
