import type { PlaylistImport, Track } from "../types";
import { invidious } from "./invidious";
import { fromItem } from "./model";
export const playlistJob = (id: string): PlaylistImport => ({ id, name: "YouTubeから取り込み", tracks: [], unavailable: [], next: "1", pages: [], fingerprints: [], received: 0, status: "paused" });
export async function fetchPlaylist(job: PlaylistImport, save: (job: PlaylistImport) => Promise<void>, signal: AbortSignal) {
  let current: PlaylistImport = { ...job, status: "fetching", error: undefined };
  await save(current);
  try {
    while (current.next) {
      signal.throwIfAborted();
      if (current.pages.includes(current.next)) throw Error("ページ送りが進まないため中断しました");
      let result: Awaited<ReturnType<typeof invidious.playlist>> | undefined;
      let error: unknown;
      for (let attempt = 0; attempt < 2 && !result; attempt++) {
        try { result = await invidious.playlist(current.id, current.next, signal); }
        catch (e) { signal.throwIfAborted(); error = e; }
      }
      if (!result) throw error;
      signal.throwIfAborted();
      if (result.received > 0 && current.fingerprints?.includes(result.fingerprint)) throw Error("接続先が同じページを返しました。取得済みデータを保持して中断しました。");
      if (!result.received && result.total !== undefined && current.received < result.total)
        throw Error("全曲数に達する前に空のページが返されました。非公開曲または取得漏れの可能性があります。");
      const tracks: Track[] = [];
      const unavailable = [...current.unavailable];
      for (const item of result.relatedStreams) {
        const track = fromItem(item);
        const title = item.title || "不明な曲";
        if (!track || /^(\[?private video\]?|\[?deleted video\]?|非公開動画|削除された動画)$/i.test(title))
          unavailable.push({ title, reason: /private|非公開/i.test(title) ? "非公開" : /deleted|削除/i.test(title) ? "削除済み" : "取得不能" });
        else tracks.push(track);
      }
      const received = current.received + result.received;
      const total = result.total ?? current.total;
      const next = result.nextpage || "";
      current = { ...current, name: result.name, total, received, next,
        pages: [...current.pages, current.next], fingerprints: [...(current.fingerprints || []), result.fingerprint],
        tracks: [...new Map([...current.tracks, ...tracks].map(t => [t.id, t])).values()], unavailable,
        status: next ? "fetching" : total !== undefined && received < total ? "error" : "complete",
        error: !next && total !== undefined && received < total ? "取得件数が全曲数に達していません。取得先が返さない曲があります。" : undefined };
      await save(current);
    }
  } catch (e) {
    current = { ...current, status: signal.aborted ? "paused" : "error", error: signal.aborted ? undefined : e instanceof Error ? e.message : String(e) };
    await save(current);
  }
  return current;
}
