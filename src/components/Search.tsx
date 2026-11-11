import { useEffect, useRef, useState } from "react";
import { Search as SearchIcon, Link, RefreshCw } from "lucide-react";
import type { Track, InvidiousItem } from "../types";
import { invidious } from "../lib/invidious";
import { fromItem, videoId, placeholder, playlistId } from "../lib/model";
import { store, useStore } from "../lib/store";
import { TrackList } from "./TrackList";
export function Search({ onAdd }: { onAdd: (ids: string[]) => void }) {
  const { data } = useStore();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Track[]>([]);
  const [channels, setChannels] = useState<InvidiousItem[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [nextpage, setNextpage] = useState<string | undefined>();
  const [filter, setFilter] = useState("all");
  const [submitted, setSubmitted] = useState("");
  const abort = useRef<AbortController | null>(null);
  const suggestionRequest = useRef<AbortController | null>(null);
  const lastSearch = useRef<() => Promise<void>>(async () => {});
  const request = useRef(0);
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    if (query.length < 2) {
      setSuggestions([]);
      return;
    }
    const c = new AbortController();
    suggestionRequest.current = c;
    const timer = setTimeout(
      () =>
        void invidious
          .suggestions(query, c.signal)
          .then((items) => { if (!c.signal.aborted) setSuggestions(items); })
          .catch(() => {}),
      500,
    );
    return () => {
      clearTimeout(timer);
      c.abort();
    };
  }, [query]);
  async function search(q = query, more = false, type = filter) {
    q = q.trim();
    if (!q) return;
    const playlist = playlistId(q);
    if (playlist && !videoId(q)) {
      location.hash = "import/" + playlist;
      return;
    }
    abort.current?.abort();
    suggestionRequest.current?.abort();
    lastSearch.current = () => search(q, more, type);
    abort.current = new AbortController();
    const signal = abort.current.signal,
      token = ++request.current;
    setBusy(true);
    setError("");
    setSuggestions([]);
    if (!more) {
      setSubmitted(q);
      setResults([]);
      setChannels([]);
      setNextpage(undefined);
    }
    store.update((d) => ({
      ...d,
      searches: [q, ...d.searches.filter((x) => x !== q)].slice(0, 30),
    }));
    try {
      const id = videoId(q);
      if (id) {
        let track = placeholder(id);
        try {
          const info = await invidious.streams(id, signal);
          track = {
            ...track,
            title: info.title,
            uploader: info.uploader,
            thumbnail: info.thumbnailUrl,
            duration: info.duration,
            uploaderUrl: info.uploaderUrl,
          };
        } catch {
          if (signal.aborted) return;
          setError(
            "Invidiousから動画の詳細を取得できません。再生時に別のInvidious接続先で再取得します。",
          );
        }
        if (signal.aborted || token !== request.current) return;
        store.addTracks([track]);
        setResults([track]);
      } else {
        const page = await invidious.search(
          q,
          more ? nextpage : undefined,
          signal,
          type === "channel" ? "channels" : "videos",
        );
        if (signal.aborted || token !== request.current) return;
        const tracks = page.items.map(fromItem).filter((t): t is Track => !!t);
        store.addTracks(tracks);
        setResults((prev) =>
          more
            ? [...new Map([...prev, ...tracks].map((t) => [t.id, t])).values()]
            : tracks,
        );
        const receivedChannels = page.items.filter((t) => t.type === "channel");
        setChannels((previous) => [...new Map((more ? [...previous, ...receivedChannels] : receivedChannels)
          .map((channel) => [channel.url, channel])).values()]);
        setNextpage(page.nextpage || undefined);
      }
      setSubmitted(q);
    } catch (e) {
      if (!signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (token === request.current) setBusy(false);
    }
  }
  async function openChannel(channel: InvidiousItem) {
    if (!channel.url) return;
    abort.current?.abort();
    suggestionRequest.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    const token = ++request.current;
    lastSearch.current = () => openChannel(channel);
    setBusy(true);
    setError("");
    setSuggestions([]);
    try {
      const tracks = await invidious.channel(channel.url, controller.signal);
      if (controller.signal.aborted) return;
      store.addTracks(tracks);
      setChannels([]);
      setNextpage(undefined);
      setResults(tracks);
      setFilter("all");
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (token === request.current) setBusy(false);
    }
  }
  const visible = results;
  return (
    <>
      <div className="page-intro">
        <div className="eyebrow">曲を検索</div>
        <h1>聴きたい曲を探す</h1>
        <p>曲名・歌い手・YouTube URLで検索できます。</p>
      </div>
      <form
        className="searchform"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <SearchIcon size={22} />
        <input
          aria-label="楽曲を検索"
          placeholder="曲名・歌い手・YouTube URL"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setSuggestions([]); }}
        />
        <button
          className="primary"
          type="submit"
          disabled={!query.trim()}
        >
          {busy ? "検索中…" : "検索"}
        </button>
      </form>
      <p className="search-help">検索するだけではキューは変わりません。曲をタップするとその1曲を再生します。</p>
      {suggestions.length > 0 && (
        <div className="suggestions">
          {suggestions.slice(0, 6).map((s) => (
            <button
              key={s}
              onClick={() => {
                setQuery(s);
                void search(s);
              }}
            >
              {s}
            </button>
          ))}
        </div>
      )}
      <div className="chips" role="group" aria-label="検索対象">
        {[
          ["all", "曲・動画"],
          ["channel", "チャンネル"],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={filter === id ? "selected" : ""}
            aria-pressed={filter === id}
            onClick={() => {
              setFilter(id);
              const term = query.trim() || submitted;
              if (term) void search(term, false, id);
              else {
                setResults([]);
                setChannels([]);
                setNextpage(undefined);
                setSubmitted("");
              }
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {error && (
        <div className="error" role="alert">
          <p>{error}</p>
          <button onClick={() => void lastSearch.current()}>
            <RefreshCw size={16} />
            再試行
          </button>
          <a
            href={`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`}
            target="_blank"
            rel="noreferrer"
          >
            YouTubeで検索 ↗
          </a>
        </div>
      )}
      {!submitted && !busy && !error && (
        <section className="panel">
          <Link size={22} />
          <h3>リンクからも、すぐに再生。</h3>
          <p className="muted">
            YouTubeのURLや11文字の動画IDを検索欄に貼り付けてください。
          </p>
          <div className="chips">
            {data.searches.slice(0, 8).map((q) => (
              <button
                key={q}
                onClick={() => {
                  setQuery(q);
                  void search(q);
                }}
              >
                {q}
              </button>
            ))}
          </div>
        </section>
      )}
      {busy && (
        <div className="loading" role="status">
          利用可能な接続先で検索しています…
          <button
            onClick={() => {
              abort.current?.abort();
              request.current++;
              setBusy(false);
            }}
          >
            中断
          </button>
        </div>
      )}
      {visible.length > 0 && (
        <div className="section-heading">
          <h2>
            検索結果 <small>{visible.length}曲</small>
          </h2>
          <button className="search-play-all" title="検索結果の全曲を再生キューに登録します" onClick={() => store.playList(visible.map((t) => t.id), 0, true)}>
            すべて再生
          </button>
        </div>
      )}
      {visible.length > 0 && <TrackList key={submitted} tracks={visible} onAdd={onAdd} selectable singlePlay />}
      {!busy && !error && submitted && !visible.length && !channels.length && (
        <p className="empty" role="status">検索結果がありません。別の語句で検索してください。</p>
      )}
      {channels.map((c, i) => (
        <div key={i} className="panel">
          <b>{c.name}</b>
          <div className="actions">
            <button
              aria-pressed={!!c.url && data.channels.includes(c.url)}
              onClick={() => {
                const url = c.url;
                if (!url) return;
                store.update((d) => ({
                  ...d,
                  channels: d.channels.includes(url) ? d.channels.filter((v) => v !== url) : [...d.channels, url],
                }));
              }}
            >
              {c.url && data.channels.includes(c.url) ? "歌い手の保存を解除" : "歌い手を保存"}
            </button>
            <button onClick={() => void openChannel(c)}
            >
              投稿曲を表示
            </button>
          </div>
        </div>
      ))}
      {nextpage && (
        <button
          className="loadmore"
          disabled={busy}
          onClick={() => void search(submitted, true)}
        >
          さらに読み込む
        </button>
      )}
    </>
  );
}
