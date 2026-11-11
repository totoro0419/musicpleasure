import { useState } from "react";
import {
  Play,
  Plus,
  Music2,
  Heart,
  Copy,
  Trash2,
  Search,
  ArrowLeft,
} from "lucide-react";
import { store, useStore } from "../lib/store";
import { move, newPlaylist, time, unique, safeImage } from "../lib/model";
import { TrackList } from "./TrackList";
export function PlaylistCard({ id }: { id: string }) {
  const { data } = useStore();
  const p = data.playlists.find((p) => p.id === id);
  if (!p) return null;
  const img = p.cover || data.tracks[p.tracks[0]]?.thumbnail;
  return (
    <a className="playlist-card" href={`#playlist/${id}`}>
      <div className="playlist-art">
        {img ? <img src={img} alt="" loading="lazy" /> : <Music2 size={44} />}
        <span className="card-play">
          <Play fill="currentColor" size={24} />
        </span>
      </div>
      <b>{p.name}</b>
      <span>
        {p.tracks.length}曲 {p.favorite ? " · ♥" : ""}
      </span>
    </a>
  );
}
export function Library({
  id,
  onAdd,
}: {
  id?: string;
  onAdd: (ids: string[]) => void;
}) {
  const { data } = useStore();
  const [name, setName] = useState("");
  const [tab, setTab] = useState("playlists");
  const [search, setSearch] = useState("");
  const [selection, setSelection] = useState<string[]>([]);
  const [destination, setDestination] = useState("");
  const [merge, setMerge] = useState("");
  const [editing, setEditing] = useState(false);
  const p = data.playlists.find((x) => x.id === id);
  function patch(value: Partial<typeof p>) {
    store.update(
      (d) => ({
        ...d,
        playlists: d.playlists.map((x) =>
          x.id === id ? { ...x, ...value } : x,
        ),
      }),
      true,
    );
  }
  if (p) {
    const tracks = p.tracks.map((id) => data.tracks[id]).filter(Boolean);
    const filtered = tracks.filter((t) =>
      `${t.title} ${t.uploader}`.toLowerCase().includes(search.toLowerCase()),
    );
    const total = tracks.reduce((s, t) => s + t.duration, 0);
    return (
      <>
        <a className="back" href="#library">
          <ArrowLeft size={17} />
          ライブラリ
        </a>
        <div className="playlist-header">
          <div className="playlist-art">
            {p.cover || tracks[0]?.thumbnail ? (
              <img src={p.cover || tracks[0]?.thumbnail} alt="" />
            ) : (
              <Music2 size={64} />
            )}
          </div>
          <div>
            <div className="eyebrow">YOUR PLAYLIST</div>
            <h1>{p.name}</h1>
            <p className="muted">
              {p.description || "あなたの好きな音を、ひとつに。"}
            </p>
            <p>
              {tracks.length}曲 · {time(total)}
            </p>
            <div className="actions">
              <button
                className="primary"
                disabled={!tracks.length}
                onClick={() => store.playList(p.tracks)}
              >
                <Play size={18} fill="currentColor" />
                再生
              </button>
              <button
                onClick={() => store.shuffle()}
                aria-pressed={data.shuffle}
              >
                シャッフル {data.shuffle ? "ON" : "OFF"}
              </button>
              <button
                className="icon"
                aria-label="プレイリストをお気に入り"
                onClick={() => patch({ favorite: !p.favorite })}
              >
                <Heart size={19} fill={p.favorite ? "currentColor" : "none"} />
              </button>
              <button onClick={() => setEditing(!editing)}>編集</button>
            </div>
          </div>
        </div>
        {editing && (
          <section className="panel">
            <div className="formgrid">
              <label>
                プレイリスト名
                <input
                  value={p.name}
                  onChange={(e) => patch({ name: e.target.value })}
                />
              </label>
              <label>
                カバー画像URL
                <input
                  value={p.cover}
                  onChange={(e) => patch({ cover: e.target.value })}
                  onBlur={(e) => {
                    if (e.target.value && !safeImage(e.target.value)) {
                      store.notify("カバー画像はHTTPS URLを入力してください");
                      patch({ cover: "" });
                    }
                  }}
                />
              </label>
              <label>
                説明文
                <textarea
                  value={p.description}
                  onChange={(e) => patch({ description: e.target.value })}
                />
              </label>
            </div>
            <div className="actions">
              <button
                onClick={() =>
                  store.update(
                    (d) => ({
                      ...d,
                      playlists: [
                        ...d.playlists,
                        {
                          ...newPlaylist(`${p.name} のコピー`, p.tracks),
                          description: p.description,
                          cover: p.cover,
                        },
                      ],
                    }),
                    true,
                  )
                }
              >
                <Copy size={17} />
                複製
              </button>
              <select
                aria-label="結合するプレイリスト"
                value={merge}
                onChange={(e) => setMerge(e.target.value)}
              >
                <option value="">結合するリストを選択</option>
                {data.playlists
                  .filter((x) => x.id !== p.id)
                  .map((x) => (
                    <option value={x.id} key={x.id}>
                      {x.name}
                    </option>
                  ))}
              </select>
              <button
                disabled={!merge}
                onClick={() => {
                  const other = data.playlists.find((x) => x.id === merge);
                  if (other)
                    patch({ tracks: unique([...p.tracks, ...other.tracks]) });
                }}
              >
                このリストに結合
              </button>
              <button
                className="danger"
                onClick={() => {
                  store.update(
                    (d) => ({
                      ...d,
                      playlists: d.playlists.filter((x) => x.id !== p.id),
                    }),
                    true,
                  );
                  location.hash = "library";
                }}
              >
                <Trash2 size={17} />
                プレイリスト削除
              </button>
            </div>
          </section>
        )}
        <div className="section-heading">
          <div className="inline-search">
            <Search size={17} />
            <input
              aria-label="プレイリスト内検索"
              placeholder="このリストを検索"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <a className="button" href="#import">
            <Plus size={17} />
            一括登録
          </a>
        </div>
        {selection.length > 0 && (
          <div className="bulkbar">
            <button
              onClick={() =>
                patch({
                  tracks: p.tracks.filter((x) => !selection.includes(x)),
                })
              }
            >
              選択した{selection.length}曲を削除
            </button>
            <select
              aria-label="曲の移動先"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
            >
              <option value="">移動先を選択</option>
              {data.playlists
                .filter((x) => x.id !== p.id)
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
            </select>
            <button
              disabled={!destination}
              onClick={() =>
                store.update(
                  (d) => ({
                    ...d,
                    playlists: d.playlists.map((x) =>
                      x.id === destination
                        ? { ...x, tracks: unique([...x.tracks, ...selection]) }
                        : x.id === p.id
                          ? {
                              ...x,
                              tracks: x.tracks.filter(
                                (id) => !selection.includes(id),
                              ),
                            }
                          : x,
                    ),
                  }),
                  true,
                )
              }
            >
              選択曲を移動
            </button>
          </div>
        )}
        <TrackList
          tracks={filtered}
          selectable
          onSelection={setSelection}
          onAdd={onAdd}
          reorder={
            !search
              ? (from, to) => patch({ tracks: move(p.tracks, from, to) })
              : undefined
          }
          onRemove={(i) =>
            patch({ tracks: p.tracks.filter((x) => x !== filtered[i].id) })
          }
        />
      </>
    );
  }
  return (
    <>
      <div className="page-intro">
        <div className="eyebrow">YOUR COLLECTION</div>
        <h1>好きな音を、手元に。</h1>
        <p>プレイリストも、聴いてきた曲も。ここから。</p>
      </div>
      <div className="chips">
        <a className="button" href="#local">保存した音楽・音声取り込み</a>
        {[
          ["playlists", "プレイリスト"],
          ["favorites", "お気に入り"],
          ["history", "再生履歴"],
          ["channels", "歌い手"],
        ].map(([id, label]) => (
          <button
            className={tab === id ? "selected" : ""}
            key={id}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "playlists" && (
        <>
          <form
            className="new-playlist"
            onSubmit={(e) => {
              e.preventDefault();
              const id = store.create(name);
              setName("");
              location.hash = `playlist/${id}`;
            }}
          >
            <input
              aria-label="新しいプレイリスト名"
              placeholder="新しいプレイリスト名"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button className="primary" disabled={!name.trim()}>
              <Plus size={18} />
              作成
            </button>
          </form>
          <div className="playlist-grid">
            {data.playlists.map((p) => (
              <PlaylistCard id={p.id} key={p.id} />
            ))}
          </div>
          {!data.playlists.length && (
            <div className="empty">
              <Music2 size={38} />
              <h3>最初のプレイリストを作ろう。</h3>
              <p>曲一覧の貼り付けから、まとめて登録することもできます。</p>
              <a className="button" href="#import">
                曲一覧から始める
              </a>
            </div>
          )}
        </>
      )}
      {tab === "favorites" && (
        <TrackList
          tracks={data.favorites.map((id) => data.tracks[id]).filter(Boolean)}
          onAdd={onAdd}
        />
      )}
      {tab === "history" && (
        <TrackList
          tracks={data.history.map((id) => data.tracks[id]).filter(Boolean)}
          onAdd={onAdd}
        />
      )}
      {tab === "channels" && (
        <div className="panel">
          {data.channels.length ? (
            data.channels.map((c) => (
              <div className="section-heading" key={c}>
                <span>
                  {Object.values(data.tracks).find((t) => t.uploaderUrl === c)
                    ?.uploader || c}
                </span>
                <button
                  onClick={() =>
                    store.update((d) => ({
                      ...d,
                      channels: d.channels.filter((x) => x !== c),
                    }))
                  }
                >
                  解除
                </button>
              </div>
            ))
          ) : (
            <p>曲の「•••」から好きな歌い手を保存できます。</p>
          )}
        </div>
      )}
    </>
  );
}
