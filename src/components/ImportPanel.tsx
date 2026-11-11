import { useEffect, useRef, useState } from "react";
import { Sparkles, ClipboardPaste, Check, AlertCircle } from "lucide-react";
import { store, useStore } from "../lib/store";
import {
  parseList,
  resolveItem,
} from "../lib/importer";
import { playlistId } from "../lib/model";
import { fetchPlaylist, playlistJob } from "../lib/playlist-import";
import type { Track } from "../types";
export function ImportPanel({ initialPlaylistUrl = "", initialTarget }: {
  initialPlaylistUrl?: string;
  initialTarget?: string;
}) {
  const { data } = useStore();
  const [text, setText] = useState("");
  const [target, setTarget] = useState(initialTarget ?? data.playlists[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [registering, setRegistering] = useState(false);
  const registration = useRef(false);
  const cancel = useRef<AbortController | null>(null);
  const [playlistURL, setPlaylistURL] = useState(initialPlaylistUrl);
  const job = data.playlistImport;
  const preview = job?.tracks || [];
  const playlistName = job?.name || "YouTubeから取り込み";
  const [error, setError] = useState("");
  useEffect(() => () => cancel.current?.abort(), []);
  const items = data.importJob;
  async function run(reset = false) {
    if (cancel.current || registration.current) return;
    setError("");
    const work = reset ? parseList(text) : items;
    if (!work.length) {
      setError("曲一覧を入力してください");
      return;
    }
    store.update((d) => ({ ...d, importJob: work }));
    setBusy(true);
    cancel.current = new AbortController();
    const signal = cancel.current.signal;
    try {
      for (let i = 0; i < work.length; i++) {
        if (signal.aborted) break;
        if (work[i].status === "matched" || work[i].status === "review")
          continue;
        const result = await resolveItem(work[i], signal);
        if (signal.aborted) break;
        store.update((d) => ({
          ...d,
          importJob: d.importJob.map((x, j) => (i === j ? result : x)),
        }));
        await store.flush();
      }
    } catch (e) {
      if (!signal.aborted) setError(String(e));
    } finally {
      cancel.current = null;
      setBusy(false);
    }
  }
  async function register(tracks: Track[], name: string) {
    if (!tracks.length || cancel.current || registration.current) return;
    registration.current = true;
    setRegistering(true);
    setError("");
    try {
      const result = store.addPlaylistTracks(target, name, tracks);
      setTarget(result.id);
      await store.flush();
      store.notify(result.added ? `${result.added}曲を登録しました。元に戻すで取り消せます。` : "選択した曲は登録済みです。");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      registration.current = false;
      setRegistering(false);
    }
  }
  function commit() {
    const chosen = items.flatMap((x) =>
      x.selected ? x.candidates.filter((t) => t.id === x.selected) : [],
    );
    void register(chosen, "取り込んだ曲");
  }
  async function loadPlaylist(resume = false) {
    if (cancel.current || registration.current) return;
    setError("");
    const id = playlistId(playlistURL);
    if (!resume && !id) { setError("YouTubeプレイリストURLを入力してください"); return; }
    const work = resume || (job?.id === id && job.next && job.status !== "complete") ? job : playlistJob(id!);
    if (!work) return;
    setBusy(true); cancel.current = new AbortController();
    try {
      await fetchPlaylist(work, async (playlistImport) => {
        store.update(d => ({ ...d, playlistImport }));
        await store.flush();
      }, cancel.current.signal);
    } catch (e) { setError(String(e)); }
    finally { cancel.current = null; setBusy(false); }
  }
  const complete = items.filter((x) => x.status !== "pending").length;
  return (
    <div className="import-layout">
      <section className="panel">
        <div className="eyebrow">
          <Sparkles size={16} /> 曲を一括登録
        </div>
        <h2>曲のリストをまとめて登録</h2>
        <p className="muted">
          曲名やYouTube URLを1行ずつ貼り付けてください。候補を確認してからプレイリストへ追加します。
        </p>
        <label>
          登録先プレイリスト
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">新しいプレイリスト</option>
            {data.playlists.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          曲一覧
          <textarea
            rows={7}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              "1. 曲名 — 歌い手\n2. 曲名 cover\nhttps://www.youtube.com/watch?v=..."
            }
          />
        </label>
        <div className="actions">
          <button
            className="primary"
            disabled={busy || registering || !text.trim()}
            onClick={() => void run(true)}
          >
            <ClipboardPaste size={18} />
            検索・照合する
          </button>
          {items.some((x) => x.status === "pending" || x.status === "failed") && (
            <button disabled={busy} onClick={() => void run()}>
              未完了を再開 / 再試行
            </button>
          )}
          {busy && (
            <button onClick={() => cancel.current?.abort()}>中断する</button>
          )}
        </div>
        {items.length > 0 && (
          <>
            <progress value={complete} max={items.length} />
            <p className="muted">
              {complete} / {items.length}件 · 確定{" "}
              {items.filter((x) => x.selected).length} · 要確認{" "}
              {items.filter((x) => x.status === "review" && !x.selected).length}{" "}
              · 失敗 {items.filter((x) => x.status === "failed").length}
            </p>
            <div className="import-items">
              {items.map((x, i) => (
                <div className="import-item" key={`${x.query}-${i}`}>
                  <span>
                    {x.selected ? (
                      <Check size={17} />
                    ) : (
                      <AlertCircle size={17} />
                    )}
                  </span>
                  <div>
                    <b>{x.query}</b>
                    {x.error && <small>{x.error}</small>}
                    {x.candidates.length > 0 && (
                      <select
                        aria-label={`${x.query}の候補`}
                        value={x.selected || ""}
                        onChange={(e) =>
                          store.update((d) => ({
                            ...d,
                            importJob: d.importJob.map((v, j) =>
                              j === i
                                ? {
                                    ...v,
                                    selected: e.target.value || undefined,
                                  }
                                : v,
                            ),
                          }))
                        }
                      >
                        <option value="">候補を選択してください</option>
                        {x.candidates.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.title} — {t.uploader}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <button
              className="primary"
              disabled={busy || registering || !items.some((x) => x.selected)}
              onClick={commit}
            >
              確定した曲を登録
            </button>
          </>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </section>
      <div>
        <section className="panel">
          <h3>YouTubeプレイリスト</h3>
          <p className="muted">
            取得した曲を確認してから登録します。途中で失敗しても、取得済みの曲は残ります。
          </p>
          <label>
            プレイリストURL
            <input
              value={playlistURL}
              onChange={(e) => setPlaylistURL(e.target.value)}
              placeholder="https://youtube.com/playlist?list=..."
            />
          </label>
          <div className="actions">
            <button
              disabled={busy || registering || !playlistURL}
              onClick={() => void loadPlaylist()}
            >
              全ページを自動取得
            </button>
            {job?.next && job.status !== "complete" && <button disabled={busy} onClick={() => void loadPlaylist(true)}>取得を再開 / 再試行</button>}
            {busy && <button onClick={() => cancel.current?.abort()}>取得を中断</button>}
          </div>
          {job && <div role="status"><p>{job.tracks.length}曲取得 / {job.received}件確認{job.total !== undefined ? ` / 全${job.total}件` : ""} · {job.status === "complete" ? "全ページ取得完了" : job.status === "fetching" ? "取得中" : job.status === "error" ? "取得未完了" : "中断中"}</p>{job.status === "fetching" && <progress aria-label="プレイリスト取得の進捗" value={job.total ? job.received : undefined} max={job.total || 1} />}{job.error && <p className="error">{job.error}</p>}{job.unavailable.map((x,i) => <p key={i}>{x.title}：{x.reason}</p>)}</div>}
          {preview.length > 0 && (
            <>
              <p>
                {playlistName} · {preview.length}曲
              </p>
              <div className="preview-list">
                {preview.map((t) => (
                  <p key={t.id}>{t.title}</p>
                ))}
              </div>
              <button
                className="primary"
                disabled={busy || registering}
                onClick={() => void register(preview, playlistName)}
              >
                {registering ? "保存中…" : `この${preview.length}曲を取り込む`}
              </button>
            </>
          )}
        </section>

      </div>
    </div>
  );
}
