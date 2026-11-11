import { useState } from "react";
import {
  Play,
  Plus,
  Music2,
  Copy,
  Trash2,
  Search,
  ArrowLeft,
} from "lucide-react";
import { store, useStore } from "../lib/store";
import { move, newPlaylist, time, unique, safeImage } from "../lib/model";
import { TrackList } from "./TrackList";
import { LocalLibrary } from "./LocalLibrary";
import { ImportPanel } from "./ImportPanel";
import { PlaylistCommands } from "./PlaylistCommands";
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
        {p.tracks.length}曲
      </span>
    </a>
  );
}
export function Library({
  id,
  onAdd,
  initialTab = "playlists",
  initialPlaylistUrl,
  initialTarget,
}: {
  id?: string;
  onAdd: (ids: string[]) => void;
  initialTab?: "playlists" | "local" | "import";
  initialPlaylistUrl?: string;
  initialTarget?: string;
}) {
  const { data } = useStore();
  const [name, setName] = useState("");
  const [tab, setTab] = useState<string>(initialTab);
  const [search, setSearch] = useState("");
  const [selection, setSelection] = useState<string[]>([]);
  const [destination, setDestination] = useState("");
  const [merge, setMerge] = useState("");
  const [editing, setEditing] = useState(false);
  const [coverDraft, setCoverDraft] = useState<string>();
  const [showCommands, setShowCommands] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
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
                onClick={() => store.playList(p.tracks, 0, true)}
              >
                <Play size={18} fill="currentColor" />
                再生
              </button>
              <button
                disabled={!tracks.length}
                onClick={() => {
                  if (!store.data.shuffle) store.shuffle();
                  store.playList(p.tracks, 0, true);
                }}
              >
                シャッフル再生
              </button>
              <button onClick={() => setEditing(!editing)}>編集</button>
              <button aria-expanded={showCommands} onClick={() => setShowCommands(!showCommands)}>
                まとめて編集
              </button>
            </div>
          </div>
        </div>
        {showCommands && <PlaylistCommands playlistId={p.id} />}
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
                カバー画像を選ぶ
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file) return;
                    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 2_000_000) {
                      store.notify("PNG・JPEG・WebPの2MB以下の画像を選んでください");
                      return;
                    }
                    const objectUrl = URL.createObjectURL(file);
                    try {
                      const image = new Image();
                      image.src = objectUrl;
                      await image.decode();
                      if (!image.width || !image.height || image.width * image.height > 16_000_000) {
                        throw Error("画像が大きすぎるか読み込めません");
                      }
                      const scale = Math.min(1, 512 / Math.max(image.width, image.height));
                      const canvas = document.createElement("canvas");
                      canvas.width = Math.max(1, Math.round(image.width * scale));
                      canvas.height = Math.max(1, Math.round(image.height * scale));
                      const context = canvas.getContext("2d");
                      if (!context) throw Error("画像を処理できません");
                      context.drawImage(image, 0, 0, canvas.width, canvas.height);
                      const cover = canvas.toDataURL("image/webp", 0.72);
                      if (!safeImage(cover)) throw Error("画像を小さくできませんでした");
                      patch({ cover });
                    } catch (error) {
                      store.notify(error instanceof Error ? error.message : String(error));
                    } finally {
                      URL.revokeObjectURL(objectUrl);
                    }
                  }}
                />
              </label>
              <details>
                <summary>画像URLで指定する</summary>
                <label>
                  カバー画像URL
                  <input
                    value={coverDraft ?? (p.cover.startsWith("data:") ? "" : p.cover)}
                    onChange={(e) => setCoverDraft(e.target.value)}
                    onBlur={() => {
                      if (coverDraft === undefined) return;
                      const url = coverDraft.trim();
                      setCoverDraft(undefined);
                      if (url && !safeImage(url)) {
                        store.notify("画像はHTTPS URLを入力してください");
                        return;
                      }
                      if (url !== p.cover) patch({ cover: url });
                    }}
                  />
                </label>
              </details>
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
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 size={17} />
                プレイリスト削除
              </button>
              {confirmDelete && (
                <div className="confirmation" role="group" aria-label="プレイリスト削除の確認">
                  <p>「{p.name}」を削除しますか？ 曲の履歴や保存済み音声は削除されません。</p>
                  <button className="danger" onClick={() => {
                    store.update((d) => ({
                      ...d,
                      playlists: d.playlists.filter((x) => x.id !== p.id),
                    }), true);
                    setConfirmDelete(false);
                    location.hash = "library";
                  }}>削除を確定</button>
                  <button onClick={() => setConfirmDelete(false)}>キャンセル</button>
                </div>
              )}
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
          <a className="button" href={`#import/target/${encodeURIComponent(p.id)}`}>
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
        <h1>ライブラリ</h1>
        <p>プレイリスト・お気に入り・保存した音楽をここで管理できます。</p>
      </div>
      <div className="chips">
        {[
          ["playlists", "プレイリスト"],
          ["favorites", "お気に入り"],
          ["history", "再生履歴"],
          ["local", "オフライン音楽"],
          ["import", "曲を追加"],
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
      {tab === "local" && <LocalLibrary onAdd={onAdd} />}
      {tab === "import" && <ImportPanel initialPlaylistUrl={initialPlaylistUrl} initialTarget={initialTarget} />}
    </>
  );
}
