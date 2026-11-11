import { useEffect, useRef, useState } from "react";
import { Download, FolderOpen, HardDrive, Music2 } from "lucide-react";
import { store, useStore } from "../lib/store";
import { player } from "../lib/player";
import { TrackList } from "./TrackList";
import { capacity, deleteAudio, downloadBlob, importAudio, putAudio, reconcileLocal, savedAudio, MAX_AUDIO_BYTES } from "../lib/local-audio";
import type { Track } from "../types";
const bytes = (n?: number) => n === undefined ? "不明" : `${(n / 1024 / 1024).toFixed(1)} MB`;
export function LocalLibrary({ onAdd }: { onAdd: (ids: string[]) => void }) {
  const { data } = useStore();
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, name: "" });
  const [results, setResults] = useState<string[]>([]);
  const [usage, setUsage] = useState<Awaited<ReturnType<typeof capacity>>>();
  const [remove, setRemove] = useState("");
  const [edit, setEdit] = useState<Track>();
  const [url, setURL] = useState("");
  const [permitted, setPermitted] = useState(false);
  const abort = useRef<AbortController | undefined>(undefined);
  const refresh = () => capacity().then(setUsage).catch(e => store.notify(String(e)));
  useEffect(() => { void refresh(); return () => abort.current?.abort(); }, []);
  const tracks = Object.values(data.tracks).filter(t => t.source === "local");
  const filtered = tracks.filter(t => `${t.title} ${t.uploader}`.toLowerCase().includes(search.toLowerCase()));
  async function run(files: File[]) {
    if (!files.length || busy) return;
    setBusy(true); setResults([]); abort.current = new AbortController();
    const signal = abort.current.signal;
    try {
      for (let i = 0; i < files.length; i++) {
        if (signal.aborted) break;
        const file = files[i]; setProgress({ done: i, total: files.length, name: file.name });
        try {
          const { track, duplicate } = await importAudio(file, signal);
          // Keep user edits when the same bytes are selected again.
          store.addTracks([{ ...track, ...store.data.tracks[track.id], local: track.local }]);
          await store.flush();
          setResults(r => [...r, `${file.name}：${duplicate ? "保存済み（重複なし）" : "保存しました"}`]);
        } catch (e) {
          if (signal.aborted) break;
          setResults(r => [...r, `${file.name}：${e instanceof Error ? e.message : String(e)}`]);
        }
        setProgress({ done: i + 1, total: files.length, name: file.name });
      }
    } finally { setBusy(false); await refresh(); }
  }
  async function fetchAllowed() {
    setBusy(true); setResults([]); abort.current = new AbortController();
    const signal = AbortSignal.any([abort.current.signal, AbortSignal.timeout(60000)]);
    try {
      const source = new URL(url);
      if (source.protocol !== "https:" || source.username || source.password ||
        /(^|\.)(youtube\.com|youtu\.be|googlevideo\.com|youtube-nocookie\.com)$/.test(source.hostname) ||
        /invidious|^inv\.|^yt\./i.test(source.hostname) || /videoplayback|latest_version/.test(source.pathname))
        throw Error("保存が許可されたHTTPSの音声ファイルURLを指定してください。YouTubeの配信URLは保存対象外です。");
      const response = await fetch(source.href, { credentials: "omit", signal });
      if (!response.ok) throw Error(`HTTP ${response.status}：取得できません`);
      if (!response.body) throw Error("音声データがありません");
      const length = Number(response.headers.get("content-length")) || 0;
      if (length > MAX_AUDIO_BYTES) { await response.body.cancel(); throw Error("128MB以下の音源を指定してください"); }
      const reader = response.body.getReader();
      const chunks: ArrayBuffer[] = []; let received = 0;
      try {
        while (true) {
          const { done, value } = await reader.read(); if (done) break;
          received += value.byteLength;
          if (received > MAX_AUDIO_BYTES) throw Error("128MBを超えたため中断しました");
          chunks.push(value.slice().buffer);
          setProgress({ done: received, total: length, name: "許可された音源を取得中" });
        }
      } finally { await reader.cancel().catch(() => {}); }
      signal.throwIfAborted();
      const filename = decodeURIComponent(source.pathname.split("/").pop() || "音源.mp3");
      const file = new File(chunks, filename, { type: response.headers.get("content-type")?.split(";")[0] || "" });
      const { track, duplicate } = await importAudio(file, signal);
      store.addTracks([track]); await store.flush();
      setResults([duplicate ? "この音源は保存済みです" : "保存しました。オフラインで再生できます。"]);
    } catch (e) { setResults([abort.current.signal.aborted ? "中断しました。保存済みの音源は保持しています。" : `取得失敗：${e instanceof Error ? e.message : String(e)}。取得元のCORSや利用条件をご確認ください。`]); }
    finally { setBusy(false); await refresh(); }
  }
  return <>
    <div className="page-intro"><div className="eyebrow"><HardDrive size={16} /> OFFLINE MUSIC</div><h2>保存した音楽</h2><p>自分の音声ファイルを取り込んで、通信なしでも聴けます。</p></div>
    <section className="panel local-import">
      <h2><FolderOpen size={21} /> 音声ファイルを取り込む</h2>
      <p className="muted">MP3・M4A・AAC・Ogg・WAV・FLAC・WebM（端末が再生できる形式、1曲128MBまで）。複数選択できます。</p>
      <div className="actions"><label className={`button primary file-button ${busy ? "disabled" : ""}`}><Music2 size={18} /> 音声を選択<input aria-label="取り込む音声ファイル" type="file" accept="audio/*,.mp3,.m4a,.aac,.ogg,.opus,.wav,.flac,.webm" multiple disabled={busy} onChange={e => { const files = Array.from(e.target.files || []); e.target.value = ""; void run(files); }} /></label>

        {busy && <button onClick={() => abort.current?.abort()}>取り込みを中断</button>}</div>
      {busy && <div role="status"><p>{progress.name}</p><progress aria-label="音声取り込みの進捗" value={progress.total ? progress.done : undefined} max={progress.total || 1} /><p>{progress.total && progress.total < 10000 ? `${progress.done} / ${progress.total}件` : `${bytes(progress.done)}取得`}</p></div>}
      {!!results.length && <div className="import-results" role="status">{results.map((r, i) => <p key={i}>{r}</p>)}{progress.done < progress.total && !busy && <p>保存済みの曲は残っています。同じファイルを選択すると未保存分だけ追加します。</p>}</div>}
      <p className="muted">音声 {usage?.count || 0}曲 · {bytes(usage?.bytes || 0)} / このサイトの使用量 {bytes(usage?.usage)} / 上限目安 {bytes(usage?.quota)} · 保存保護 {usage?.persistent ? "有効" : "未許可"}</p>
      <p className="muted">ブラウザのデータ消去で音源も消えます。JSONバックアップは曲情報のみです。元の音声を保管するか、下の「音声を書き出す」を使ってください。</p>
      <details><summary>保存が許可されたHTTPS音源から取り込む</summary><label>音声ファイルURL<input type="url" value={url} onChange={e => setURL(e.target.value)} placeholder="https://example.com/my-song.mp3" /></label><label><input type="checkbox" checked={permitted} onChange={e => setPermitted(e.target.checked)} /> この音源のダウンロード・オフライン利用が許可されています</label><p className="muted">取得元がブラウザからの取得を許可している場合に利用できます。</p><button disabled={busy || !permitted || !url} onClick={() => void fetchAllowed()}>許可された音源を保存</button></details>
    </section>
    <div className="section-heading"><label>保存曲を検索<input type="search" value={search} onChange={e => setSearch(e.target.value)} /></label><button disabled={!filtered.some(t => t.local?.available)} onClick={() => store.playList(filtered.filter(t => t.local?.available).map(t => t.id), 0, true)}>保存曲を連続再生</button></div>
    <TrackList tracks={filtered} onAdd={onAdd} />
    <section className="panel"><h2>音源の管理</h2>{filtered.map(t => <div className="local-management" key={t.id}><span>{t.title}<small>{bytes(t.local?.bytes)} · {t.local?.available ? "オフラインで再生可能" : "音声未保存・元ファイルを再取り込み"}</small></span><div className="actions"><button onClick={() => setEdit({ ...t })}>曲情報を編集</button><button disabled={!t.local?.available} onClick={async () => { try { const blob = await savedAudio(t.id); if (!blob) throw Error("音声ファイルがありません"); downloadBlob(blob, t.local!.filename); } catch(e) { store.notify(String(e)); } }}><Download size={16} />音声を書き出す</button><button className="danger" disabled={!t.local?.available} onClick={() => setRemove(t.id)}>音源を削除</button></div></div>)}
      {remove && <div className="confirmation"><p>「{data.tracks[remove]?.title}」の保存音声を削除します。曲情報とプレイリストは残ります。音声の削除は元に戻せません。</p><button className="danger" onClick={async () => { try { if (player.state.trackId === remove) player.stop(); await deleteAudio(remove); const tracks = await reconcileLocal(store.data.tracks); store.update(d => ({ ...d, tracks })); await store.flush(); setRemove(""); await refresh(); } catch(e) { store.notify(String(e)); } }}>削除を確定</button><button onClick={() => setRemove("")}>キャンセル</button></div>}
      {edit && <form className="confirmation" onSubmit={async e => { e.preventDefault(); try { const blob = await savedAudio(edit.id); if (blob) await putAudio(edit, blob); store.addTracks([edit]); await store.flush(); setEdit(undefined); } catch(e) { store.notify(String(e)); } }}><label>曲名<input required value={edit.title} onChange={e => setEdit({ ...edit, title: e.target.value })} /></label><label>アーティスト<input value={edit.uploader} onChange={e => setEdit({ ...edit, uploader: e.target.value })} /></label><button className="primary">曲情報を保存</button><button type="button" onClick={() => setEdit(undefined)}>キャンセル</button></form>}
    </section>
  </>;
}
