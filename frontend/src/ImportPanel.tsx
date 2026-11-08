import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  ClipboardPaste,
  Loader2,
  Search,
  SquarePen,
  Upload,
  X,
  Sparkles,
} from "lucide-react";
import { useStore } from "./store";
import { search, assistant } from "./api";
import { normalized, uid } from "./types";
import type { ImportRow, Track, Proposal } from "./types";
import { deduplicateEntries } from "./store";
export default function ImportPanel({
  notify,
  openPlaylist,
}: {
  notify: (s: string) => void;
  openPlaylist: (id: string) => void;
}) {
  const s = useStore();
  const [mode, setMode] = useState<"paste" | "assistant">("paste"),
    [text, setText] = useState(""),
    [name, setName] = useState("新しいプレイリスト"),
    [rows, setRows] = useState<ImportRow[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [proposal, setProposal] = useState<Proposal | null>(null),
    [target, setTarget] = useState("new");
  const cancelled = useRef(false);
  const worker = useRef<Worker | null>(null);
  useEffect(
    () => () => {
      cancelled.current = true;
      worker.current?.terminate();
    },
    [],
  );
  const update = (id: string, v: Partial<ImportRow>) =>
    setRows((old) => old.map((r) => (r.id === id ? { ...r, ...v } : r)));
  async function resolve(input: ImportRow[]) {
    setBusy(true);
    setError("");
    cancelled.current = false;
    setRows(input);
    const out: ImportRow[] = [];
    for (const row of input) {
      if (cancelled.current) break;
      if (row.skip) {
        out.push(row);
        continue;
      }
      try {
        const existing = Object.values(useStore.getState().tracks).filter(
          (t) =>
            normalized(t.title) === normalized(row.title) &&
            (!row.artist || normalized(t.artist) === normalized(row.artist)),
        );
        if (existing.length) {
          const next = {
            ...row,
            candidates: existing,
            selectedId: existing.length === 1 ? existing[0].id : undefined,
          };
          out.push(next);
          update(row.id, next);
          continue;
        }
        const isPlaylist =
          !!row.url && new URL(row.url).searchParams.has("list");
        let result = await search(
          row.url || `${row.artist} ${row.title}`.trim(),
        );
        if (isPlaylist) {
          const tracks = [...result.items];
          const tokens = new Set<string>();
          while (result.nextPageToken && !cancelled.current) {
            if (tokens.has(result.nextPageToken) || tracks.length >= 5000)
              throw new Error(
                "プレイリスト取得の安全上限に達しました。分割して取り込んでください",
              );
            tokens.add(result.nextPageToken);
            result = await search(row.url!, result.nextPageToken);
            tracks.push(...result.items);
          }
          out.push(
            ...tracks.map((t, i) => ({
              id: row.id + "-" + i,
              raw: t.title,
              title: t.title,
              artist: t.artist,
              candidates: [t],
              selectedId: t.id,
            })),
          );
        } else {
          const candidates = result.items;
          const next = {
            ...row,
            candidates,
            selectedId:
              row.url && candidates.length === 1 ? candidates[0].id : undefined,
            error: candidates.length ? undefined : "候補が見つかりませんでした",
          };
          out.push(next);
          update(row.id, next);
        }
      } catch (e) {
        const next = {
          ...row,
          error: e instanceof Error ? e.message : "検索に失敗しました",
        };
        out.push(next);
        update(row.id, next);
      }
    }
    if (!cancelled.current) setRows(out);
    setBusy(false);
  }
  function parse() {
    worker.current?.terminate();
    setError("");
    setBusy(true);
    const w = new Worker(new URL("./import.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.current = w;
    w.onmessage = (e) => {
      w.terminate();
      if (e.data.error) {
        setError(e.data.error);
        setBusy(false);
      } else {
        const parsed = e.data.rows as ImportRow[];
        if (!parsed.length) {
          setError("曲一覧を入力してください");
          setBusy(false);
          return;
        }
        void resolve(parsed);
      }
    };
    w.onerror = () => {
      setBusy(false);
      setError("取り込み内容を解析できませんでした");
    };
    w.postMessage(text);
  }
  function apply() {
    const tracks = rows
      .filter((r) => !r.skip && r.selectedId)
      .map((r) => r.candidates?.find((t) => t.id === r.selectedId))
      .filter((t): t is Track => !!t);
    if (!tracks.length) return;
    const id = target === "new" ? s.createPlaylist(name, tracks) : target;
    if (target !== "new") {
      s.addTracks(tracks);
      s.updatePlaylist(id, (p) => {
        p.entries.push(...tracks.map((t) => ({ id: uid(), trackId: t.id })));
      });
    }
    notify(`${tracks.length}曲を登録しました`);
    setRows([]);
    setText("");
    openPlaylist(id);
  }
  async function ask() {
    setBusy(true);
    setError("");
    try {
      setProposal(await assistant(text, Object.values(s.tracks)));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function applyProposal() {
    if (!proposal) return;
    const queries: string[] = [];
    for (const op of proposal.operations) {
      if (op.type === "search") queries.push(...(op.queries || []));
      if (op.type === "create_playlist") {
        const ts = (op.trackIds || [])
          .map((id) => s.tracks[id])
          .filter(Boolean);
        s.createPlaylist(op.name || "AIプレイリスト", ts);
      }
      if (["exclude_live", "deduplicate", "sort_artist"].includes(op.type)) {
        const ids = target === "new" ? [] : [target];
        for (const id of ids)
          s.updatePlaylist(id, (p) => {
            if (op.type === "exclude_live")
              p.entries = p.entries.filter(
                (e) =>
                  !s.tracks[e.trackId].sources.some((a) => a.kind === "live"),
              );
            if (op.type === "deduplicate") deduplicateEntries(p, s.tracks);
            if (op.type === "sort_artist")
              p.entries.sort((a, b) =>
                s.tracks[a.trackId].artist.localeCompare(
                  s.tracks[b.trackId].artist,
                  "ja",
                ),
              );
          });
      }
    }
    setProposal(null);
    if (queries.length) {
      setMode("paste");
      setText(queries.join("\n"));
      notify("検索候補を取り込み欄に展開しました。候補を確認してください");
    } else notify("操作案を適用しました。取り消しが可能です");
  }
  const selected = rows.filter((r) => !r.skip && r.selectedId).length;
  return (
    <section className="ai-panel">
      <div className="eyebrow">
        <Sparkles size={15} /> YOUR MUSIC, REIMAGINED
      </div>
      <h1>ひらめきを、プレイリストに。</h1>
      <p className="muted">
        ChatGPTの曲一覧を貼り付けて、あなたのライブラリへ。
      </p>
      <div className="segmented">
        <button
          className={mode === "paste" ? "active" : ""}
          onClick={() => setMode("paste")}
        >
          <ClipboardPaste size={17} />
          コピペ取り込み
        </button>
        <button
          className={mode === "assistant" ? "active" : ""}
          onClick={() => setMode("assistant")}
        >
          <Sparkles size={17} />
          AIアシスタント
        </button>
      </div>
      <div className="surface compose">
        <label htmlFor="music-input">
          {mode === "paste"
            ? "曲一覧・YouTube URL"
            : "音楽について、何をしたいですか？"}
        </label>
        <textarea
          id="music-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            mode === "paste"
              ? "アーティスト - 曲名\n1行1曲、Markdown表、CSV、JSONにも対応\nYouTubeプレイリストのURLも貼り付けられます"
              : "例：夜に聴く曲を30曲集めて\nこのプレイリストからライブ音源を除外して"
          }
          rows={7}
        />
        <div className="compose-footer">
          <span className="muted small">
            {mode === "paste"
              ? "入力は最大500行 / 1MB。検索候補は確定前に確認できます。"
              : "AI接続にはサーバー側のAPI設定が必要です。"}
          </span>
          <button
            className="primary"
            disabled={busy || !text.trim()}
            onClick={mode === "paste" ? parse : ask}
          >
            {busy ? (
              <Loader2 className="spin" size={18} />
            ) : (
              <Sparkles size={18} />
            )}{" "}
            {mode === "paste" ? "解析して候補を探す" : "操作案を作成"}
          </button>
          {busy && (
            <button
              onClick={() => {
                cancelled.current = true;
                worker.current?.terminate();
                setBusy(false);
              }}
            >
              中止
            </button>
          )}
        </div>
      </div>
      <div className="destination">
        <label>
          保存・整理するプレイリスト
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="new">新規プレイリスト</option>
            {s.playlists.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        {target === "new" && (
          <label>
            プレイリスト名
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
            />
          </label>
        )}
      </div>
      {error && (
        <p role="alert" className="error-box">
          {error}
        </p>
      )}
      {proposal && (
        <div className="surface proposal">
          <h2>変更プレビュー</h2>
          <p>{proposal.summary}</p>
          <ul>
            {proposal.operations.map((op, i) => (
              <li key={i}>
                {
                  {
                    search: "楽曲候補を検索",
                    exclude_live: "ライブを除外",
                    deduplicate: "重複を削除",
                    sort_artist: "アーティスト順に整列",
                    create_playlist: "プレイリスト作成",
                  }[op.type]
                }{" "}
                {op.name} {op.queries?.join("、")}
              </li>
            ))}
          </ul>
          {target === "new" &&
          proposal.operations.some((op) =>
            ["exclude_live", "deduplicate", "sort_artist"].includes(op.type),
          ) ? (
            <p className="muted">
              整理対象の既存プレイリストを選んでください。
            </p>
          ) : (
            <button className="primary" onClick={applyProposal}>
              変更を適用
            </button>
          )}
        </div>
      )}
      {!!rows.length && (
        <div className="import-preview">
          <div className="section-title">
            <h2>
              登録プレビュー <span>{rows.length}曲</span>
            </h2>
            <button
              className="primary"
              disabled={busy || !selected}
              onClick={apply}
            >
              <Check size={18} />
              {selected}曲を確定
            </button>
          </div>
          <p className="muted small">
            同名曲や別バージョンを確認して候補を選んでください。未選択の行は登録されません。
          </p>
          {rows.map((r, i) => (
            <div className="import-row" key={r.id}>
              <input
                type="checkbox"
                aria-label={`${i + 1}行目を除外`}
                checked={!!r.skip}
                onChange={(e) => update(r.id, { skip: e.target.checked })}
              />
              <span className="row-index">
                {String(i + 1).padStart(2, "0")}
              </span>
              <div>
                <strong>{r.title || r.url}</strong>
                <p>
                  {r.artist}
                  {r.warning && <small> · {r.warning}</small>}
                </p>
                {r.error && <span className="error">{r.error}</span>}
                <select
                  aria-label={`${i + 1}行目の候補`}
                  value={r.selectedId || ""}
                  disabled={r.skip || busy}
                  onChange={(e) => update(r.id, { selectedId: e.target.value })}
                >
                  <option value="">
                    {r.candidates?.length
                      ? "候補を選んでください"
                      : "候補未取得"}
                  </option>
                  {r.candidates?.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.artist} — {t.title} / {t.sources[0]?.kind || "未確認"}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ))}
          {!busy && rows.some((r) => r.error) && (
            <button onClick={() => void resolve(rows)}>
              失敗した候補を再検索
            </button>
          )}
        </div>
      )}
      <div className="ai-notes">
        <div>
          <ClipboardPaste />
          <h3>AIは、いつもの場所で。</h3>
          <p>
            ChatGPTで作った曲一覧をそのまま貼り付け。AIキーなしで利用できます。
          </p>
        </div>
        <div>
          <Search />
          <h3>候補を見て、選べる。</h3>
          <p>同名の曲やライブ版を確認してから登録。判断をあなたに残します。</p>
        </div>
        <div>
          <Upload />
          <h3>何度でも、行き来できる。</h3>
          <p>プレイリストをテキストやJSONで書き出して、編集後に再取り込み。</p>
        </div>
      </div>
    </section>
  );
}
