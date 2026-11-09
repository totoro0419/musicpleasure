import { useState } from "react";
import { Download, Upload, RefreshCw, ShieldCheck, Server } from "lucide-react";
import { store, useStore } from "../lib/store";
import { validateBackup } from "../lib/model";
import { piped } from "../lib/piped";
import { player } from "../lib/player";
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
            Piped音声再生専用。再生できない場合は別のPiped接続先へ切り替えます。
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
          </p>
          <div className="actions">
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
                      tracks: { ...d.tracks, ...backup.tracks },
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
            オフラインでも保存済みライブラリを閲覧できます。音声再生には通信が必要です。
          </p>
        </section>
        <section className="panel">
          <h2>推薦の重み</h2>
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
          <button
            onClick={() => {
              store.update((d) => ({ ...d, disliked: [], listening: {} }));
              store.notify(
                "好みの学習をリセットしました。お気に入りは保持しています。",
              );
            }}
          >
            好みの学習をリセット
          </button>
        </section>
      </div>
      <section className="panel">
        <div className="section-heading">
          <h2>
            <Server size={20} />
            Pipedの接続状態
          </h2>
          <button
            disabled={checking}
            onClick={async () => {
              setChecking(true);
              try {
                await piped.check();
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
          公式の公開一覧を自動取得します。API応答成功と音声再生成功は別々に記録します。「未検証」は動作保証を意味しません。
        </p>
        <label>
          接続先
          <select
            value={data.settings.instance}
            onChange={(e) => store.settings({ instance: e.target.value })}
          >
            <option value="">自動選択</option>
            {piped.health.map((h) => (
              <option key={h.url} value={h.url}>
                {new URL(h.url).hostname}
              </option>
            ))}
          </select>
        </label>
        <div className="instance-list">
          {piped.health.map((h) => (
            <div className="instance" key={h.url}>
              <div>
                <b>{new URL(h.url).hostname}</b>
                <small>
                  {h.lastError ||
                    (!h.lastChecked
                      ? "未検証"
                      : `応答 ${Math.round(h.latency)}ms`)}
                </small>
              </div>
              <span>
                API {h.success}成功 / {h.failure}失敗
              </span>
              <span className={h.audioSuccess ? "good" : "muted"}>
                音声 {h.audioSuccess ? h.audioSuccess + "回成功" : "未確認"}
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
        <details>
          <summary>任意の接続先を追加</summary>
          <div className="actions">
            <input
              aria-label="Piped API URL"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="https://..."
            />
            <button
              onClick={() => {
                try {
                  piped.add(custom);
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
                    engine: "piped",
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
      </section>
    </>
  );
}
