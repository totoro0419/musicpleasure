import { useState } from "react";
import { Download, Upload, RefreshCw, ShieldCheck, Server } from "lucide-react";
import { store, useStore } from "../lib/store";
import { validateBackup } from "../lib/model";
import { invidious } from "../lib/invidious";
import { player } from "../lib/player";
import { reliability } from "../lib/reliability";
import type { Data } from "../types";
export function Settings({
  onInstall,
  updateAvailable,
  onUpdate,
}: {
  onInstall: () => void;
  updateAvailable: boolean;
  onUpdate: () => void;
}) {
  const { data } = useStore();
  const [backup, setBackup] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [custom, setCustom] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const [checking, setChecking] = useState(false);
  const [audioChecking, setAudioChecking] = useState(false);
  const [audioCheckId, setAudioCheckId] = useState("jfKfPfyJRdk");
  function exportData() {
    const blob = new Blob([JSON.stringify({ ...data, version: 2 }, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `MusicPleasure-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  return (
    <>
      <div className="page-intro">
        <div className="eyebrow">MAKE IT YOURS</div>
        <h1>設定</h1>
        <p>あなたに合う聴き方と、大切な音楽のバックアップ。</p>
      </div>
      <div className="settings-grid">
        <section className="panel">
          <h2>再生</h2>
          <p className="muted">
            オンライン音楽はInvidiousで再生し、保存した音源はオフラインでも再生できます。
          </p>
          <label>
            音声品質
            <select
              value={data.settings.quality}
              onChange={(e) =>
                store.settings({
                  quality: e.target.value as typeof data.settings.quality,
                })
              }
            >
              <option value="balanced">バランス · 約128kbps優先</option>
              <option value="high">高音質 · 約192kbps優先</option>
              <option value="data">通信量節約 · 約64kbps優先</option>
            </select>
          </label>
          <label>
            表示
            <select
              value={data.settings.theme}
              onChange={(e) =>
                store.settings({ theme: e.target.value as "dark" | "light" })
              }
            >
              <option value="dark">ダーク</option>
              <option value="light">ライト</option>
            </select>
          </label>
          <details>
            <summary>通信量と読み込みの詳細設定</summary>
            <label><input type="checkbox" checked={data.settings.prefetch !== false} onChange={e => store.settings({ prefetch: e.target.checked })} />次曲の事前読み込み</label>
          </details>
          <p className="muted">
            形式は端末の対応状況から選択します。MP3変換は行いません。
          </p>
        </section>
        <section className="panel">
          <h2>
            <ShieldCheck size={20} />
            データのバックアップ
          </h2>
          <p className="muted">
            データはこのブラウザに保存されます。端末の変更やブラウザデータの削除前に書き出してください。
            JSONには音声ファイルを含みません。「保存した音楽」から音声を別に書き出してください。
          </p>
          <div className="actions">
            <button onClick={async () => {
              try {
                const allowed = await navigator.storage?.persist?.();
                store.notify(allowed
                  ? "この端末で保存データの自動削除を抑制する許可を得ました。元の音声も保管してください。"
                  : "このブラウザでは保存保護を利用できません。元の音声ファイルを保管してください。");
              } catch(e) { store.notify(e instanceof Error ? e.message : String(e)); }
            }}>オフライン音声の保存を保護</button>
            <button onClick={exportData}>
              <Download size={18} />
              JSONを書き出す
            </button>
            <label className="button file-button">
              <Upload size={18} />
              JSONを読み込む
              <input
                type="file"
                accept="application/json,.json"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  try {
                    if (f.size > 30_000_000)
                      throw Error("30MB以下のファイルを選択してください");
                    setBackup(validateBackup(JSON.parse(await f.text())));
                    setError("");
                  } catch (e) {
                    setError(e instanceof Error ? e.message : String(e));
                  }
                  e.target.value = "";
                }}
              />
            </label>
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {backup && (
            <div className="confirmation">
              <p>
                読込内容：{Object.keys(backup.tracks).length}曲 /{" "}
                {backup.playlists.length}プレイリスト
              </p>
              <p>
                現在のデータに結合します。同じIDのプレイリストは読み込みデータを優先します。
              </p>
              <button
                className="primary"
                onClick={() => {
                  player.stop();
                  store.enableSaving();
                  store.update(
                    (d) => ({
                      ...d,
                      tracks: { ...d.tracks, ...Object.fromEntries(Object.entries(backup.tracks).map(([id, t]) => [id, t.source === "local" && t.local ? { ...t, local: { ...t.local, available: !!d.tracks[id]?.local?.available } } : t])) },
                      playlists: [
                        ...new Map(
                          [...d.playlists, ...backup.playlists].map((p) => [
                            p.id,
                            p,
                          ]),
                        ).values(),
                      ],
                      favorites: [
                        ...new Set([...d.favorites, ...backup.favorites]),
                      ],
                      channels: [
                        ...new Set([...d.channels, ...backup.channels]),
                      ],
                      listening: { ...d.listening, ...backup.listening },
                      history: [...new Set([...backup.history, ...d.history])],
                      settings: backup.settings,
                      queue: backup.queue,
                      current: backup.current,
                      position: backup.position,
                      radio: backup.radio,
                      shuffle: backup.shuffle,
                      repeat: backup.repeat,
                    }),
                    true,
                  );
                  setBackup(null);
                  store.notify(
                    "バックアップを復元しました。再生ボタンで再開できます。",
                  );
                }}
              >
                確認して復元
              </button>
              <button onClick={() => setBackup(null)}>キャンセル</button>
            </div>
          )}
        </section>
        <section className="panel">
          <h2>アプリ</h2>
          <div className="actions">
            <button onClick={onInstall}>アプリをインストール</button>
            <button
              onClick={() =>
                void navigator.serviceWorker
                  ?.getRegistration()
                  .then((r) => r?.update())
                  .then(() =>
                    store.notify(
                      "更新を確認しました。新しい版があれば更新ボタンが表示されます。",
                    ),
                  )
                  .catch(() => store.notify("更新を確認できませんでした"))
              }
            >
              <RefreshCw size={17} />
              更新を確認
            </button>
            {updateAvailable && (
              <button className="primary" onClick={onUpdate}>
                最新版へ更新
              </button>
            )}
          </div>
          <p className="muted">
            v2.0.0 · {__BUILD_ID__}
            <br />
            保存済みの音源はオフラインで再生できます。オンライン曲の再生・検索には通信が必要です。
          </p>
        </section>
        <details className="panel">
          <summary>おすすめの詳細調整</summary>
          <p className="muted">通常は自動のまま使用できます。数値は必要な場合だけ変更してください。</p>
          {Object.entries(data.settings.weights).map(([key, value]) => (
            <label key={key}>
              {
                (
                  {
                    related: "現在の曲との関連",
                    favorite: "お気に入り・歌い手",
                    fresh: "未再生曲",
                    recent: "最近聴いた曲への減点",
                  } as Record<string, string>
                )[key]
              }{" "}
              · {value}
              <input
                type="range"
                min="0"
                max="20"
                value={value}
                onChange={(e) =>
                  store.settings({
                    weights: {
                      ...data.settings.weights,
                      [key]: Number(e.target.value),
                    },
                  })
                }
              />
            </label>
          ))}
          <button onClick={() => setConfirmReset(true)}>
            好みの学習をリセット
          </button>
          {confirmReset && (
            <div className="confirmation" role="group" aria-label="推薦の学習リセットの確認">
              <p>再生履歴から学習した好みと「興味なし」の記録をリセットします。お気に入りやプレイリストは残ります。</p>
              <button className="danger" onClick={() => {
                store.update((d) => ({ ...d, disliked: [], listening: {} }));
                setConfirmReset(false);
                store.notify("好みの学習をリセットしました。お気に入りは保持しています。");
              }}>リセットを確定</button>
              <button onClick={() => setConfirmReset(false)}>キャンセル</button>
            </div>
          )}
        </details>
      </div>
      <details className="panel troubleshooting">
        <summary>再生できないときの接続設定・診断</summary>
        <p className="muted">音が出ない場合にだけ確認してください。接続先は通常、自動で選ばれます。</p>
        <div className="section-heading">
          <h2>
            <Server size={20} />
            接続状況
          </h2>
          <button
            disabled={checking}
            onClick={async () => {
              setChecking(true);
              try {
                await invidious.check();
              } finally {
                setChecking(false);
              }
            }}
          >
            <RefreshCw size={17} />
            {checking ? "確認中…" : "再評価"}
          </button>
        </div>
        <p className="muted">
          通常は自動選択のままで使えます。再生できない場合だけ接続先を変更してください。
        </p>
        <label>
          接続先
          <select
            value={data.settings.instance}
            onChange={(e) => store.settings({ instance: e.target.value })}
          >
            <option value="">自動選択</option>
            {invidious.health.map((h) => (
              <option key={h.url} value={h.url}>
                {new URL(h.url).hostname}
              </option>
            ))}
          </select>
        </label>
        <details className="advanced-instance-list">
          <summary>接続先の通信状況を詳しく見る</summary>
        <div className="instance-list">
          {invidious.health.map((h) => (
            <div className="instance" key={h.url}>
              <div>
                <b>{new URL(h.url).hostname}</b>
                <small>
                  {h.lastAudioError ||
                    h.lastError ||
                    (!h.lastChecked
                      ? "未検証"
                      : `応答 ${Math.round(h.latency)}ms`)}
                </small>
              </div>
              <span>
                API {h.success}成功 / {h.failure}失敗
              </span>
              <span className={h.audioSuccess ? "good" : "muted"}>
                音声 {h.audioSuccess ? h.audioSuccess + "回成功" : "未確認"} /{" "}
                {h.audioFailure || 0}失敗 · 先行確認{h.audioPrepared || 0}回
              </span>
              <span>
                {h.cooldown > Date.now()
                  ? "一時停止"
                  : h.lastChecked
                    ? "再試行可"
                    : "未検証"}
              </span>
            </div>
          ))}
        </div>
        </details>
        <details>
          <summary>失敗した段階と一時除外の診断</summary>
          <p className="muted">
            API成功・音源の先行確認・実再生成功は別々に記録します。ネットワークとCORSを区別できない場合も明記します。一時除外してもプレイリストの曲は削除しません。
          </p>
          <button
            onClick={() => {
              reliability.clear();
              store.notify(
                "一時除外を解除しました。次の再生時に再確認します。",
              );
            }}
          >
            一時除外を解除
          </button>
          <pre
            data-testid="playback-diagnostics"
            style={{
              maxHeight: 320,
              overflow: "auto",
              fontSize: 10,
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
            }}
          >
            {JSON.stringify(
              { events: reliability.events, excluded: reliability.excluded, starts: player.metrics, media: { time: player.audio.currentTime, duration: player.audio.duration, paused: player.audio.paused, ended: player.audio.ended, seeking: player.audio.seeking, ready: player.audio.readyState, network: player.audio.networkState, currentTrack: player.state.trackId, status: player.state.status } },
              null,
              2,
            )}
          </pre>
        </details>
        <details>
          <summary>任意の接続先を追加</summary>
          <div className="actions">
            <input
              aria-label="Invidious API URL"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="https://..."
            />
            <button
              onClick={() => {
                try {
                  invidious.add(custom);
                  setCustom("");
                } catch (e) {
                  store.notify(String(e));
                }
              }}
            >
              追加
            </button>
          </div>
        </details>
        <details>
          <summary>選択した接続先の音声再生を確認</summary>
          <p className="muted">
            現在の再生は停止します。実際に再生が始まった接続先だけが「音声成功」になります。
          </p>
          <div className="actions">
            <input
              aria-label="検証用動画ID"
              value={audioCheckId}
              onChange={(e) => setAudioCheckId(e.target.value)}
            />
            <button
              disabled={audioChecking || !/^[\w-]{11}$/.test(audioCheckId)}
              onClick={async () => {
                player.stop();
                setAudioChecking(true);
                const id = audioCheckId;
                const track = {
                  id,
                  title: `音声確認 · ${id}`,
                  uploader: "接続検証",
                  duration: 0,
                  thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
                };
                store.addTracks([track]);
                store.update((d) => ({
                  ...d,
                  queue: [id],
                  current: 0,
                  position: 0,
                }));
                try {
                  await player.load(track, {
                    ...data.settings,
                    engine: "invidious",
                  });
                } finally {
                  setAudioChecking(false);
                }
              }}
            >
              音声を検証
            </button>
          </div>
        </details>
      </details>
    </>
  );
}
