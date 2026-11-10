import { useState } from "react";
import { Radio as RadioIcon, Sparkles, RefreshCw } from "lucide-react";
import { store, useStore } from "../lib/store";
import type { RadioMode, Track } from "../types";
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
  const { data } = useStore();
  const [candidates, setCandidates] = useState<Track[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const seed = data.tracks[data.queue[data.current]];
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
          <h2>{seed ? seed.title : "あなたの好きな一曲から。"}</h2>
          <p>
            {seed
              ? `${seed.uploader} を基準におすすめ`
              : "検索画面で曲の「その他の操作」から「この曲からラジオ」を選んでください。"}
          </p>
          <div className="actions">
            <button
              className="primary"
              disabled={!seed}
              onClick={() => {
                if (seed) void store.startRadio(seed);
              }}
            >
              <RadioIcon size={18} />
              ラジオを開始
            </button>
            <button
              aria-pressed={data.radio}
              onClick={() => store.update((d) => ({ ...d, radio: !d.radio }))}
            >
              自動補充 {data.radio ? "ON" : "OFF"}
            </button>
          </div>
        </div>
      </section>
      <section className="panel">
        <h3>今日は、どんな気分？</h3>
        <div className="chips">
          {Object.entries(modeLabels).map(([value, label]) => (
            <button
              key={value}
              aria-pressed={data.settings.radioMode === value}
              className={data.settings.radioMode === value ? "selected" : ""}
              onClick={() => store.settings({ radioMode: value as RadioMode })}
            >
              {label}
            </button>
          ))}
        </div>
        <label>
          発見度 · {data.settings.discovery}%
          <input
            type="range"
            min="0"
            max="100"
            value={data.settings.discovery}
            onChange={(e) =>
              store.settings({ discovery: Number(e.target.value) })
            }
          />
        </label>
        <p className="muted">
          曲名・投稿者・関連動画・お気に入り・聴き方から推薦します。音声の特徴は解析していません。
        </p>
      </section>
      <div className="section-heading">
        <h2>
          <Sparkles size={20} />
          次のおすすめ
        </h2>
        <button
          disabled={!seed || busy}
          onClick={async () => {
            if (!seed) return;
            setBusy(true);
            setError("");
            try {
              const result = await recommend(seed, store.data);
              store.addTracks(result);
              setCandidates(result);
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          <RefreshCw size={17} />
          {busy ? "探しています…" : "候補を更新"}
        </button>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <TrackList
        tracks={
          candidates.length
            ? candidates
            : data.queue
                .slice(data.current + 1)
                .map((id) => data.tracks[id])
                .filter(Boolean)
        }
        onAdd={onAdd}
        onPlay={(track) => { void store.startRadio(track); }}
      />
      {data.radio && (
        <button onClick={() => void store.fillRadio()}>キューを補充する</button>
      )}
    </>
  );
}
