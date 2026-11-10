import { useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Play,
  Heart,
  Plus,
  ListPlus,
  Radio,
  ThumbsDown,
  ArrowUp,
  ArrowDown,
  Trash2,
} from "lucide-react";
import type { Track } from "../types";
import { store, useStore } from "../lib/store";
import { time } from "../lib/model";
export function TrackList({
  tracks,
  onAdd,
  selectable = false,
  onSelection,
  reorder,
  onRemove,
  queue = false,
  singlePlay = false,
  queueOffset = 0,
  onPlay,
}: {
  tracks: Track[];
  onAdd?: (ids: string[]) => void;
  selectable?: boolean;
  onSelection?: (ids: string[]) => void;
  reorder?: (from: number, to: number) => void;
  onRemove?: (index: number) => void;
  queue?: boolean;
  singlePlay?: boolean;
  queueOffset?: number;
  onPlay?: (track: Track, index: number) => void;
}) {
  const { data } = useStore();
  const parent = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const virtual = useVirtualizer({
    count: tracks.length,
    getScrollElement: () => parent.current,
    estimateSize: () => 88,
    overscan: 5,
  });
  const useVirtual = tracks.length > 80;
  const rows = useVirtual
    ? virtual.getVirtualItems()
    : tracks.map((_, index) => ({ index, start: 0, size: 88 }));
  function playTrack(track: Track, index: number) {
    if (onPlay) {
      onPlay(track, index);
      return;
    }
    if (queue) {
      store.update((d) => ({
        ...d,
        current: index + queueOffset,
        position: 0,
      }));
      void store.playCurrent();
      return;
    }
    if (singlePlay) {
      store.playList([track.id], 0, true);
      return;
    }
    store.playList(tracks.map((item) => item.id), index);
  }
  function selection(id: string) {
    const next = selected.includes(id)
      ? selected.filter((x) => x !== id)
      : [...selected, id];
    setSelected(next);
    onSelection?.(next);
  }
  return (
    <>
      {selectable && tracks.length > 0 && (
        <div className="bulkbar">
          <label>
            <input
              type="checkbox"
              checked={selected.length === tracks.length}
              onChange={(e) => {
                const s = e.target.checked ? tracks.map((t) => t.id) : [];
                setSelected(s);
                onSelection?.(s);
              }}
            />{" "}
            すべて選択
          </label>
          <span>{selected.length}曲選択</span>
          {onAdd && (
            <button disabled={!selected.length} onClick={() => onAdd(selected)}>
              選択した曲を追加
            </button>
          )}
        </div>
      )}
      <div
        className={`tracklist ${useVirtual ? "virtual" : ""}`}
        ref={parent}
        style={useVirtual ? { height: 560, overflow: "auto" } : undefined}
      >
        <div
          style={
            useVirtual
              ? { height: virtual.getTotalSize(), position: "relative" }
              : undefined
          }
        >
          {rows.map((row) => {
            const t = tracks[row.index];
            if (!t) return null;
            const active = data.queue[data.current] === t.id;
            return (
              <div
                className={`trackrow ${active ? "active" : ""}`}
                key={`${t.id}-${row.index}`}
                style={
                  useVirtual
                    ? {
                        position: "absolute",
                        top: row.start,
                        left: 0,
                        width: "100%",
                        minHeight: row.size,
                      }
                    : undefined
                }
              >
                {selectable && (
                  <input
                    type="checkbox"
                    aria-label={`${t.title}を選択`}
                    checked={selected.includes(t.id)}
                    onChange={() => selection(t.id)}
                  />
                )}
                <button
                  className="trackart"
                  aria-label={`${t.title}を再生`}
                  onClick={() => playTrack(t, row.index)}
                >
                  <img loading="lazy" src={t.thumbnail} alt="" />
                  <Play size={20} fill="currentColor" />
                </button>
                <div className="tracktext">
                  <button
                    className="textbutton title"
                    onClick={() => playTrack(t, row.index)}
                  >
                    {t.title}
                  </button>
                  <span>
                    {t.uploader}
                    {t.verified ? " ✓" : ""}
                  </span>
                  {t.reason && <small className="reason">{t.reason}</small>}
                </div>
                <span className="duration">{time(t.duration)}</span>
                <button
                  className={`icon favorite ${data.favorites.includes(t.id) ? "selected" : ""}`}
                  title="お気に入り"
                  aria-label={`${t.title}をお気に入り${data.favorites.includes(t.id) ? "解除" : "登録"}`}
                  onClick={() => store.favorite(t.id)}
                >
                  <Heart
                    size={18}
                    fill={
                      data.favorites.includes(t.id) ? "currentColor" : "none"
                    }
                  />
                </button>
                <details
                  className="trackmenu"
                  open={open === `${t.id}-${row.index}`}
                  onToggle={(e) => {
                    if (e.currentTarget.open) setOpen(`${t.id}-${row.index}`);
                  }}
                >
                  <summary aria-label={`${t.title}のその他の操作`} title="その他の操作">•••</summary>
                  <div className="menuitems">
                    <button
                      onClick={() => {
                        store.enqueue([t.id], true);
                        setOpen(null);
                      }}
                    >
                      <ListPlus size={16} />
                      次に再生
                    </button>
                    <button
                      onClick={() => {
                        store.enqueue([t.id]);
                        setOpen(null);
                      }}
                    >
                      <Plus size={16} />
                      キューに追加
                    </button>
                    {onAdd && (
                      <button
                        onClick={() => {
                          onAdd([t.id]);
                          setOpen(null);
                        }}
                      >
                        <Plus size={16} />
                        プレイリストに追加
                      </button>
                    )}
                    <button
                      onClick={() => {
                        void store.startRadio(t);
                        setOpen(null);
                      }}
                    >
                      <Radio size={16} />
                      この曲からラジオ
                    </button>
                    <button
                      onClick={() => {
                        store.dislike(t.id);
                        setOpen(null);
                      }}
                    >
                      <ThumbsDown size={16} />
                      興味なし
                    </button>
                    {t.uploaderUrl && (
                      <button
                        onClick={() => {
                          store.update((d) => ({
                            ...d,
                            channels: d.channels.includes(t.uploaderUrl!)
                              ? d.channels.filter((x) => x !== t.uploaderUrl)
                              : [...d.channels, t.uploaderUrl!],
                          }));
                          setOpen(null);
                        }}
                      >
                        歌い手を保存 / 解除
                      </button>
                    )}
                    {reorder && (
                      <>
                        <button
                          disabled={row.index === 0}
                          onClick={() => reorder(row.index, row.index - 1)}
                        >
                          <ArrowUp size={16} />
                          上へ移動
                        </button>
                        <button
                          disabled={row.index === tracks.length - 1}
                          onClick={() => reorder(row.index, row.index + 1)}
                        >
                          <ArrowDown size={16} />
                          下へ移動
                        </button>
                      </>
                    )}
                    {onRemove && (
                      <button
                        className="danger"
                        onClick={() => onRemove(row.index)}
                      >
                        <Trash2 size={16} />
                        リストから削除
                      </button>
                    )}
                    <a
                      href={`https://www.youtube.com/watch?v=${t.id}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      YouTubeで開く ↗
                    </a>
                    <button onClick={() => setOpen(null)}>閉じる</button>
                  </div>
                </details>
              </div>
            );
          })}
        </div>
      </div>
      {!tracks.length && (
        <div className="empty">
          まだ曲がありません。検索、または曲一覧の貼り付けから追加できます。
        </div>
      )}
    </>
  );
}
