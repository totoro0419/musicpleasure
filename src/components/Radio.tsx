import { useEffect, useMemo, useRef, useState } from "react";
import { Radio as RadioIcon, Sparkles, RefreshCw, Search } from "lucide-react";
import { store, useStore } from "../lib/store";
import type { RadioMode, Track } from "../types";
import { invidious } from "../lib/invidious";
import { fromItem, unique } from "../lib/model";
import { recommend } from "../lib/recommend";
import { TrackList } from "./TrackList";
export const modeLabels: Record<RadioMode, string> = {
  favorites: "お気に入り中心",
  balance: "バランス",
  discovery: "新曲発見",
  covers: "歌ってみた特化",
  channel: "同じ歌い手",
  versions: "同じ曲の別バージョン",
};
export function Radio({ onAdd }: { onAdd: (ids: string[]) => void }) {
  const { data, playback, radioStatus } = useStore();
  const [selection, setSelection] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Track[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<{ key: string; tracks: Track[] }>();
  const [previewBusy, setPreviewBusy] = useState("");
  const [previewError, setPreviewError] = useState<{ key: string; message: string }>();
  const previewRequest = useRef<AbortController | undefined>(undefined);
  const searchRequest = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => searchRequest.current?.abort(), []);
  const current = data.tracks[data.queue[data.current]];
  const saved = useMemo(() => [
    { label: "お気に入り", ids: data.favorites },
    { label: "再生履歴", ids: data.history },
    { label: "プレイリスト", ids: unique(data.playlists.flatMap((p) => p.tracks)) },
  ], [data.favorites, data.history, data.playlists]);
  const available = (track?: Track) => track && (track.source !== "local" || track.local?.available);
  const fallback = [data.radio ? data.radioSeed : current?.id, current?.id, data.radioSeed, ...saved.flatMap((group) => group.ids)]
    .find((id) => id && available(data.tracks[id]));
  const chosen = selection ? (data.tracks[selection] || results.find((track) => track.id === selection)) : undefined;
  const seed = available(chosen) ? chosen : fallback ? data.tracks[fallback] : undefined;
  const previewKey = data.radio ? "" : `${seed?.id || ""}:${data.settings.radioMode}`;
  useEffect(() => () => previewRequest.current?.abort(), [previewKey]);
  async function updatePreview() {
    if (!seed) return;
    previewRequest.current?.abort();
    const controller = new AbortController();
    previewRequest.current = controller;
    setPreviewBusy(previewKey);
    setPreviewError(undefined);
    try {
      const tracks = await recommend(seed, store.data, controller.signal);
      if (!controller.signal.aborted) {
        if (tracks.length) store.addTracks(tracks);
        setPreview({ key: previewKey, tracks });
        if (!tracks.length) setPreviewError({ key: previewKey, message: "おすすめが見つかりませんでした。別の基準曲でお試しください。" });
      }
    } catch (e) {
      if (!controller.signal.aborted) setPreviewError({ key: previewKey, message: e instanceof Error ? e.message : String(e) });
    } finally {
      if (previewRequest.current === controller) setPreviewBusy("");
    }
  }
  const upcoming = data.radio ? data.queue.slice(data.current + 1).map((id) => data.tracks[id]).filter(Boolean) : [];
  const previewTracks = preview?.key === previewKey ? preview.tracks : [];
  const stateText = playback.status === "loading" ? "曲を準備中…"
    : playback.status === "playing" ? "再生中"
    : playback.status === "paused" ? "一時停止中"
    : playback.status === "blocked" ? "プレーヤーの再生ボタンで再開できます。"
    : radioStatus.phase === "finding" ? "次の曲を準備中…"
    : "";
  async function search() {
    const term = query.trim();
    if (!term) return;
    searchRequest.current?.abort();
    const controller = new AbortController();
    searchRequest.current = controller;
    setBusy(true);
    setError("");
    setResults([]);
    try {
      const page = await invidious.search(term, undefined, controller.signal);
      if (controller.signal.aborted) return;
      const tracks = page.items.map(fromItem).filter((track): track is Track => !!track);
      setResults([...new Map(tracks.map((track) => [track.id, track])).values()]);
      if (!tracks.length) setError("曲が見つかりませんでした。曲名や歌い手を変えて検索してください。");
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (searchRequest.current === controller) setBusy(false);
    }
  }
  return (
    <>
      <div className="page-intro">
        <div className="eyebrow">
          <RadioIcon size={16} /> 無限ラジオ
        </div>
        <h1>好きな曲から、次の曲へ</h1>
        <p>1曲を選ぶと、関連する曲を自動で追加して再生します。</p>
      </div>
      <section className="radio-hero">
        <div className="radio-orbit">
          <RadioIcon size={64} />
        </div>
        <div>
          <span className="eyebrow">再生の基準になる曲</span>
          <h2>{seed?.title || "基準曲を選んでください"}</h2>
          {seed?.uploader && <p>{seed.uploader}</p>}
          <div className="actions">
            {seed && (
              <button className="primary" onClick={() => store.startRadio(seed)}>
                <RadioIcon size={18} />
                {data.radio && data.radioSeed !== seed.id ? "この基準曲で再開" : "ラジオを開始"}
              </button>
            )}
            {data.radio && <button onClick={() => store.stopRadio()}>おすすめの自動追加を停止</button>}
          </div>
          {data.radio && stateText && <p role="status">{stateText}</p>}
        </div>
      </section>
      <section className="panel radio-seed-picker">
        <h3>{seed ? "基準曲を変更" : "曲を検索してラジオを始める"}</h3>
        {fallback && (
          <label>
            保存した曲から選ぶ
            <select value={chosen && !results.some((track) => track.id === selection) ? selection : ""} onChange={(e) => setSelection(e.target.value)}>
              <option value="">基準曲の一覧</option>
              {available(current) && <option value={current!.id}>現在の曲 · {current!.title}</option>}
              {saved.map(({ label, ids }) => {
                const tracks = ids.map((id) => data.tracks[id]).filter((track) => available(track));
                return tracks.length > 0 && (
                  <optgroup label={label} key={label}>
                    {tracks.map((track) => <option key={track.id} value={track.id}>{track.title} · {track.uploader}</option>)}
                  </optgroup>
                );
              })}
            </select>
          </label>
        )}
        <form className="searchform" onSubmit={(e) => { e.preventDefault(); void search(); }}>
          <Search size={20} />
          <input type="search" aria-label="ラジオの基準曲を検索" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="曲名・歌い手" />
          <button type="submit" disabled={!query.trim()}>{busy ? "検索中…" : "検索"}</button>
        </form>
        {error && <p className="error" role="alert">{error}</p>}
        {results.length > 0 && (
          <div className="radio-seed-results" aria-label="基準曲の検索結果">
            {results.map((track) => (
              <button key={track.id} aria-pressed={selection === track.id} onClick={() => {
                setSelection(track.id);
                store.startRadio(track);
              }}>{track.title} · {track.uploader}から開始</button>
            ))}
          </div>
        )}
      </section>
      <section className="panel">
        <h3>おすすめの方向</h3>
        <div className="chips" role="group" aria-label="おすすめの方向">
          {([
            ["balance", "おまかせ"],
            ["discovery", "新しい曲を多めに"],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              aria-pressed={data.settings.radioMode === value}
              className={data.settings.radioMode === value ? "selected" : ""}
              onClick={() => store.settings({ radioMode: value })}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="muted">
          再生履歴やお気に入りをもとに、次のおすすめを探します。
        </p>
        {!["balance", "discovery"].includes(data.settings.radioMode) && <p className="muted">現在の方向 · {modeLabels[data.settings.radioMode]}</p>}
        {data.channels.length > 0 && (
          <details>
            <summary>好みに登録した歌い手（{data.channels.length}件）</summary>
            <p className="muted">好きな歌い手は、ラジオのおすすめに反映されます。</p>
            {data.channels.map((url) => (
              <div className="section-heading" key={url}>
                <span>{Object.values(data.tracks).find((t) => t.uploaderUrl === url)?.uploader || url}</span>
                <button onClick={() => store.update((d) => ({ ...d, channels: d.channels.filter((v) => v !== url) }))}>
                  登録解除
                </button>
              </div>
            ))}
          </details>
        )}
      </section>
      {seed && (
        <>
          <div className="section-heading">
            <h2><Sparkles size={20} /> 次のおすすめ</h2>
            {data.radio && radioStatus.phase === "error" ? (
              <button onClick={() => store.retryRadio()}>
                <RefreshCw size={17} /> おすすめを再試行
              </button>
            ) : (
              <button
                disabled={data.radio ? radioStatus.phase === "finding" : previewBusy === previewKey}
                onClick={() => data.radio ? store.refreshRadio() : void updatePreview()}
              >
                <RefreshCw size={17} /> 候補を更新
              </button>
            )}
          </div>
          {(data.radio ? radioStatus.phase === "finding" : previewBusy === previewKey) &&
            <p role="status">{data.radio ? "次のおすすめの音声を確認しています…" : "候補を探しています…"}</p>}
          {data.radio && radioStatus.message && <p className="error" role="alert">{radioStatus.message}</p>}
          {!data.radio && previewError?.key === previewKey && <p className="error" role="alert">{previewError.message}</p>}
          {upcoming.length > 0 && (
            <TrackList tracks={upcoming} onAdd={onAdd} onPlay={(_, index) => store.selectQueue(data.current + 1 + index)} />
          )}
          {previewTracks.length > 0 && !data.radio && (
            <TrackList tracks={previewTracks} onAdd={onAdd} onPlay={(track) => store.startRadio(track)} />
          )}
        </>
      )}
    </>
  );
}
