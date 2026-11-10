import { useEffect, useRef, useState } from "react";
import { Sparkles, ClipboardPaste, Check, AlertCircle } from "lucide-react";
import { store, useStore } from "../lib/store";
import {
  parseList,
  resolveItem,
  planCommand,
  type CommandPlan,
} from "../lib/importer";
import { fromItem, newPlaylist } from "../lib/model";
import type { Track } from "../types";
import { invidious } from "../lib/invidious";
export function ImportPanel() {
  const { data } = useStore();
  const [text, setText] = useState("");
  const [target, setTarget] = useState(data.playlists[0]?.id || "");
  const [busy, setBusy] = useState(false);
  const cancel = useRef<AbortController | null>(null);
  const [command, setCommand] = useState("");
  const [plan, setPlan] = useState<CommandPlan | null>(null);
  const [playlistURL, setPlaylistURL] = useState("");
  const [preview, setPreview] = useState<Track[]>([]);
  const [playlistName, setPlaylistName] = useState("YouTubeから取り込み");
  const [page, setPage] = useState<string | undefined>();
  const [previewId, setPreviewId] = useState("");
  const [error, setError] = useState("");
  useEffect(() => () => cancel.current?.abort(), []);
  const items = data.importJob;
  async function run(reset = false) {
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
      setBusy(false);
    }
  }
  function commit() {
    const chosen = items.flatMap((x) =>
      x.selected ? x.candidates.filter((t) => t.id === x.selected) : [],
    );
    if (!chosen.length) return;
    store.addTracks(chosen);
    let id = target;
    if (!id) {
      id = store.create("取り込んだ曲");
      setTarget(id);
    }
    store.addToPlaylist(
      id,
      chosen.map((t) => t.id),
    );
    store.notify(`${chosen.length}曲を登録しました。元に戻すで取り消せます。`);
  }
  async function loadPlaylist(next = false) {
    setError("");
    let id = previewId;
    if (!next) {
      try {
        const u = new URL(playlistURL);
        if (!/(^|\.)youtube\.com$|^youtu\.be$/.test(u.hostname))
          throw Error("YouTube URLを入力してください");
        id = u.searchParams.get("list") || "";
        if (!/^[\w-]+$/.test(id))
          throw Error("プレイリストURLを入力してください");
        setPreviewId(id);
        setPreview([]);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return;
      }
    }
    setBusy(true);
    cancel.current = new AbortController();
    try {
      const result = await invidious.playlist(
        id,
        next ? page : undefined,
        cancel.current.signal,
      );
      setPlaylistName(result.name || playlistName);
      const tracks = result.relatedStreams
        .map(fromItem)
        .filter((x): x is Track => !!x);
      setPreview((prior) =>
        next
          ? [...new Map([...prior, ...tracks].map((t) => [t.id, t])).values()]
          : tracks,
      );
      setPage(result.nextpage || undefined);
    } catch (e) {
      if (!cancel.current.signal.aborted)
        setError(
          `取得済みの曲は保持しています。${e instanceof Error ? e.message : String(e)}`,
        );
    } finally {
      setBusy(false);
    }
  }
  const complete = items.filter((x) => x.status !== "pending").length;
  return (
    <div className="import-layout">
      <section className="panel">
        <div className="eyebrow">
          <Sparkles size={16} /> SMART IMPORT
        </div>
        <h2>曲一覧を、そのまま音楽に。</h2>
        <p className="muted">
          ChatGPTの回答、箇条書き、曲名＋歌手、YouTube
          URLに対応。名前があいまいな曲は候補を選べます。
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
            disabled={busy || !text.trim()}
            onClick={() => void run(true)}
          >
            <ClipboardPaste size={18} />
            検索・照合する
          </button>
          {items.length > 0 && (
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
              disabled={busy || !items.some((x) => x.selected)}
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
              disabled={busy || !playlistURL}
              onClick={() => void loadPlaylist()}
            >
              プレビュー取得
            </button>
            {page && (
              <button disabled={busy} onClick={() => void loadPlaylist(true)}>
                次のページを取得
              </button>
            )}
          </div>
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
                onClick={() => {
                  store.addTracks(preview);
                  if (target)
                    store.addToPlaylist(
                      target,
                      preview.map((t) => t.id),
                    );
                  else
                    store.update(
                      (d) => ({
                        ...d,
                        playlists: [
                          ...d.playlists,
                          newPlaylist(
                            playlistName,
                            preview.map((t) => t.id),
                          ),
                        ],
                      }),
                      true,
                    );
                  store.notify("取得済みの曲を登録しました");
                }}
              >
                この{preview.length}曲を取り込む
              </button>
            </>
          )}
        </section>
        <section className="panel">
          <h3>
            <Sparkles size={18} /> ことばで整理
          </h3>
          <p className="muted">
            無料のルール解析です。音声解析や外部AIへの送信は行いません。
          </p>
          <label>
            操作内容
            <input
              value={command}
              onChange={(e) => {
                setCommand(e.target.value);
                setPlan(null);
              }}
              placeholder="「歌い手名」を抽出 / 曲名順に並べ替え"
            />
          </label>
          <button
            onClick={() => {
              try {
                setPlan(planCommand(command, target, data));
                setError("");
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              }
            }}
          >
            変更をプレビュー
          </button>
          {plan && (
            <div className="confirmation">
              <p>{plan.description}</p>
              <button
                className="primary"
                onClick={() => {
                  store.update(plan.execute, true);
                  setPlan(null);
                  store.notify("変更しました。元に戻すで取り消せます。");
                }}
              >
                この変更を実行
              </button>
              <button onClick={() => setPlan(null)}>キャンセル</button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
