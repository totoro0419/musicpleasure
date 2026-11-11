import { useState } from "react";
import { Sparkles } from "lucide-react";
import { store } from "../lib/store";
import { planCommand, type CommandPlan } from "../lib/importer";

/** Operations belong to the playlist being edited, not to the import workflow. */
export function PlaylistCommands({ playlistId }: { playlistId: string }) {
  const [command, setCommand] = useState("");
  const [plan, setPlan] = useState<CommandPlan | null>(null);
  const [error, setError] = useState("");

  return (
    <section className="panel playlist-commands">
      <h3><Sparkles size={18} /> まとめて編集</h3>
      <p className="muted">
        このプレイリスト内の曲を、自然な日本語で並べ替え・抽出・追加・削除・移動できます。
        変更内容は実行前に確認でき、元に戻すこともできます。
      </p>
      <details>
        <summary>操作の例を見る</summary>
        <p>曲名順に並べ替え / お気に入りだけにする / 「曲名」を追加 /
          「歌い手」を削除 / 「別のリスト」と結合 / 重複を整理</p>
      </details>
      <label>
        操作内容
        <input
          value={command}
          onChange={(e) => { setCommand(e.target.value); setPlan(null); setError(""); }}
          placeholder="例：曲名順に並べ替え"
        />
      </label>
      <button
        disabled={!command.trim()}
        onClick={() => {
          try { setPlan(planCommand(command, playlistId, store.data)); setError(""); }
          catch (e) { setPlan(null); setError(e instanceof Error ? e.message : String(e)); }
        }}
      >変更をプレビュー</button>
      {error && <p className="error" role="alert">{error}</p>}
      {plan && (
        <div className="confirmation">
          <p>{plan.description}</p>
          <button className="primary" onClick={() => {
            try {
              store.update(plan.execute, true);
              setPlan(null);
              store.notify("変更しました。元に戻すで取り消せます。");
            } catch (e) {
              setPlan(null);
              setError(e instanceof Error ? e.message : String(e));
            }
          }}>この変更を実行</button>
          <button onClick={() => setPlan(null)}>キャンセル</button>
        </div>
      )}
    </section>
  );
}
