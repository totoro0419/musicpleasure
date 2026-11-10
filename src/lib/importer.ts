import type { ImportItem, Track, Data } from "../types";
import { videoId, placeholder, fromItem, unique, newId } from "./model";
import { words, isCover } from "./recommend";
import { invidious } from "./invidious";
export function parseList(text: string): ImportItem[] {
  const lines = text
    .split(/\r?\n/)
    .map((x) =>
      x
        .trim()
        .replace(/^\s*(?:[-*+]\s+|\d+[.)、．]\s*)/, "")
        .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "$2")
        .replace(/^「|」$/g, ""),
    )
    .filter((x) => x && !/^#{1,6}\s|^\|?\s*[-:]+\s*\||^```/.test(x));
  return unique(lines)
    .slice(0, 1000)
    .map((query) => ({ query, status: "pending", candidates: [] }));
}
export function matchScore(query: string, t: Track) {
  const q = words(query.replace(/[",]/g, " ")),
    target = words(`${t.title} ${t.uploader}`);
  const common = [...q].filter(
    (w) =>
      target.has(w) || `${t.title} ${t.uploader}`.toLowerCase().includes(w),
  ).length;
  return q.size
    ? common / q.size - (isCover(query) !== isCover(t.title) ? 0.2 : 0)
    : 0;
}
export async function resolveItem(
  item: ImportItem,
  signal?: AbortSignal,
): Promise<ImportItem> {
  const id = videoId(item.query);
  if (id) {
    let track = placeholder(id);
    try {
      const info = await invidious.streams(id, signal);
      track = {
        ...track,
        title: info.title,
        uploader: info.uploader,
        duration: info.duration,
        thumbnail: info.thumbnailUrl,
        uploaderUrl: info.uploaderUrl,
      };
    } catch {
      if (signal?.aborted) throw signal.reason;
    }
    return { ...item, status: "matched", selected: id, candidates: [track] };
  }
  try {
    const page = await invidious.search(
      item.query.replace(/[,，]/g, " "),
      undefined,
      signal,
    );
    const candidates = page.items
      .map(fromItem)
      .filter((x): x is Track => !!x)
      .sort((a, b) => matchScore(item.query, b) - matchScore(item.query, a))
      .slice(0, 5);
    if (!candidates.length) throw Error("候補なし");
    const first = matchScore(item.query, candidates[0]),
      second = candidates[1] ? matchScore(item.query, candidates[1]) : 0;
    const sure = first >= 0.9 && first - second >= 0.2;
    return {
      ...item,
      status: sure ? "matched" : "review",
      selected: sure ? candidates[0].id : undefined,
      candidates,
    };
  } catch (e) {
    if (signal?.aborted) throw e;
    return {
      ...item,
      status: "failed",
      error: e instanceof Error ? e.message : String(e),
      candidates: [],
    };
  }
}
export interface CommandPlan {
  description: string;
  execute: (data: Data) => Data;
}
export function planCommand(
  text: string,
  playlistId: string,
  data: Data,
): CommandPlan {
  const p = data.playlists.find((x) => x.id === playlistId);
  if (!p) throw Error("対象プレイリストを選択してください");
  const quote = text.match(/[「"]([^」"]+)[」"]/)?.[1];
  let result = [...p.tracks],
    description = "";
  if (/並べ|ソート|順に/.test(text)) {
    if (/歌手|投稿者|歌い手/.test(text))
      result.sort((a, b) =>
        data.tracks[a].uploader.localeCompare(data.tracks[b].uploader, "ja"),
      );
    else if (/長さ|時間/.test(text))
      result.sort((a, b) => data.tracks[a].duration - data.tracks[b].duration);
    else
      result.sort((a, b) =>
        data.tracks[a].title.localeCompare(data.tracks[b].title, "ja"),
      );
    description = `「${p.name}」の${result.length}曲を並べ替え`;
  } else if (/結合/.test(text) && quote) {
    const other = data.playlists.find((x) => x.name === quote && x.id !== p.id);
    if (!other)
      throw Error("結合先に指定した名前のプレイリストが見つかりません");
    result = unique([...result, ...other.tracks]);
    description = `「${quote}」を「${p.name}」へ結合（元のリストも保持）`;
  } else if (/作成|作って/.test(text)) {
    const name =
      quote ||
      text.replace(/プレイリスト|作成して|作って|を|新しい/g, "").trim();
    return {
      description: `「${name}」を作成`,
      execute: (d) => ({
        ...d,
        playlists: [
          ...d.playlists,
          {
            id: newId(),
            name,
            description: "",
            cover: "",
            tracks: [],
            favorite: false,
            created: Date.now(),
          },
        ],
      }),
    };
  } else if (/削除|抽出|整理/.test(text)) {
    const filtered = result.filter((id) => {
      const t = data.tracks[id];
      return quote
        ? `${t.title} ${t.uploader}`.includes(quote)
        : /カバー|歌ってみた/.test(text)
          ? isCover(t.title)
          : /お気に入り/.test(text)
            ? data.favorites.includes(id)
            : false;
    });
    if (!quote && !/カバー|歌ってみた|お気に入り/.test(text))
      throw Error("「歌い手名」のように対象をかぎ括弧で指定してください");
    result = /削除/.test(text)
      ? result.filter((id) => !filtered.includes(id))
      : filtered;
    description = `「${p.name}」: ${p.tracks.length}曲 → ${result.length}曲`;
  } else
    throw Error(
      "対応例：曲名順に並べ替え / 「歌い手名」を抽出 / 「リスト名」を結合 / 「名前」を作成。曲の追加は下の一括登録を利用してください。",
    );
  return {
    description,
    execute: (d) => ({
      ...d,
      playlists: d.playlists.map((x) =>
        x.id === p.id ? { ...x, tracks: result } : x,
      ),
    }),
  };
}
