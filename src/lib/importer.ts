import type { ImportItem, Track, Data } from "../types";
import { videoId, placeholder, fromItem, unique, newPlaylist } from "./model";
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
const libraryStamp = (d: Data) => JSON.stringify([d.playlists, d.favorites, Object.values(d.tracks).map(t => [t.id, t.title, t.uploader, t.duration])]);
export function planCommand(input: string, playlistId: string, data: Data): CommandPlan {
  const text = input.normalize("NFKC").trim();
  const quotes = [...text.matchAll(/[「『"]([^」』"]+)[」』"]/g)].map(m => m[1].trim());
  if (!text) throw Error("操作内容を入力してください");
  if (/してから|その後|さらに|した後|して、|して次/.test(text)) throw Error("一度に1つの操作を指定してください");
  const stamp = libraryStamp(data);
  const plan = (description: string, execute: (d: Data) => Data): CommandPlan => ({ description,
    execute: d => { if (libraryStamp(d) !== stamp) throw Error("プレビュー後にライブラリが変更されました。もう一度プレビューしてください。"); return execute(d); } });
  const named = (name: string) => {
    const matches = data.playlists.filter(p => p.name === name);
    if (matches.length !== 1) throw Error(matches.length ? `「${name}」が複数あります。リスト名を区別してください` : `「${name}」というプレイリストがありません`);
    return matches[0];
  };
  const checkName = (name: string) => { if (!name.trim()) throw Error("名前を指定してください"); if (data.playlists.some(p => p.name === name)) throw Error(`「${name}」は既に存在します。別の名前を指定してください`); return name; };
  if (/作成|作って|作る|つくって|新設/.test(text) && !/複製|抽出|コピー/.test(text)) {
    const name = checkName(quotes[0] || text.replace(/(?:という|と呼ぶ)?(?:新しい)?プレイリスト|(?:を)?(?:作成|作って|作る|つくって|新設)(?:して)?(?:ください)?[。!]?$/g, "").trim());
    const created = newPlaylist(name);
    return plan(`新しいプレイリスト「${name}」を作成（0曲）`, d => ({ ...d, playlists: [...d.playlists, created] }));
  }
  const p = data.playlists.find(x => x.id === playlistId);
  if (!p) throw Error("対象プレイリストを上の「登録先プレイリスト」で選択してください");
  const replace = (ids: string[], operation: string) => plan(`「${p.name}」：${operation}。${p.tracks.length}曲 → ${ids.length}曲` + (ids.length ? ` / ${ids.slice(0,5).map(id => data.tracks[id]?.title || id).join("、")}` : ""),
    d => ({ ...d, playlists: d.playlists.map(x => x.id === p.id ? { ...x, tracks: ids } : x) }));
  if (/名前|名称|リネーム/.test(text) && /変更|変えて|変える|リネーム/.test(text)) {
    if (!quotes.length) throw Error('変更後の名前を「夜」のように指定してください');
    if (quotes.length > 1 && quotes[0] !== p.name) throw Error(`選択中の対象は「${p.name}」です。対象を選び直してください`);
    const name = checkName(quotes.at(-1)!);
    return plan(`「${p.name}」の名前を「${name}」へ変更（${p.tracks.length}曲を保持）`, d => ({ ...d, playlists: d.playlists.map(x => x.id === p.id ? { ...x, name } : x) }));
  }
  if (/複製|コピー/.test(text)) {
    const name = checkName(quotes.at(-1) || `${p.name} のコピー`);
    const copy = { ...newPlaylist(name, p.tracks), description: p.description, cover: p.cover };
    return plan(`「${p.name}」の${p.tracks.length}曲を「${name}」に複製（元リストを保持）`, d => ({ ...d, playlists: [...d.playlists, copy] }));
  }
  if (/結合|統合|ひとつに|一つに|合体/.test(text)) {
    const others = quotes.filter(q => q !== p.name).map(named);
    if (!others.length) throw Error('「別のリスト」と結合、のように指定してください');
    return replace(unique([...p.tracks, ...others.flatMap(x => x.tracks)]), `${others.map(x => `「${x.name}」`).join("、")}と結合（元リストを保持）`);
  }
  if (/重複|ダブり|ダブった/.test(text) && /整理|削除|除去|まとめ|消/.test(text)) return replace(unique(p.tracks), "同じ曲IDの重複を整理");
  if (/並べ|ソート|順に|順で|順$/.test(text)) {
    let field: "title" | "uploader" | "duration";
    if (/歌手|投稿者|歌い手|アーティスト/.test(text)) field = "uploader";
    else if (/長さ|時間|長い|短い/.test(text)) field = "duration";
    else if (/曲名|タイトル|五十音|名前/.test(text)) field = "title";
    else throw Error("曲名・アーティスト・再生時間のどの順か指定してください");
    const desc = /逆順|降順|長い|多い/.test(text);
    const ids = [...p.tracks].sort((a,b) => {
      const ta = data.tracks[a], tb = data.tracks[b];
      const value = field === "duration" ? (ta?.duration || 0) - (tb?.duration || 0) : String(ta?.[field] || "").localeCompare(String(tb?.[field] || ""), "ja");
      return desc ? -value : value;
    });
    return replace(ids, `${field === "title" ? "曲名" : field === "uploader" ? "アーティスト" : "再生時間"}の${desc ? "降順" : "昇順"}に並べ替え`);
  }
  const adding = /追加|入れて|入れる|加えて|登録/.test(text);
  const moving = /移動|移して|移す/.test(text);
  const deleting = /削除|消して|消す|取り除|除いて/.test(text);
  const extracting = /抽出|取り出|残して|だけに|集めて|集める|絞/.test(text);
  if (!adding && !moving && !deleting && !extracting) throw Error("対応範囲：作成・名前変更・追加・削除・移動・結合・複製・曲名/アーティスト/時間順・条件抽出・重複整理。操作と対象を指定してください。");
  const destinationName = moving ? quotes.at(-1) : undefined;
  const destination = destinationName ? named(destinationName) : undefined;
  if (moving && (!destination || destination.id === p.id)) throw Error('別の移動先を「通学」へ移動、のように指定してください');
  const query = (moving ? quotes.slice(0,-1) : quotes)[0];
  const duration = text.match(/(\d+(?:\.\d+)?)\s*(分|秒)(以上|以下|未満|より長い|より短い)/);
  const hasCondition = !!query || /お気に入り|好きな曲|歌ってみた|カバー|cover|全曲|すべて|全部/.test(text) || !!duration;
  if (!hasCondition) throw Error('対象を特定できません。「曲名」・お気に入り・歌ってみた・5分以上・全曲などを指定してください');
  const source = adding ? Object.keys(data.tracks) : p.tracks;
  let selected = source.filter(id => {
    const t = data.tracks[id]; if (!t) return false;
    if (query && !`${t.title} ${t.uploader}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())) return false;
    if (/お気に入り|好きな曲/.test(text) && !data.favorites.includes(id)) return false;
    if (/歌ってみた|カバー|cover/i.test(text) && !isCover(t.title)) return false;
    if (duration) {
      const seconds = Number(duration[1]) * (duration[2] === "分" ? 60 : 1), comparison = duration[3];
      if (!(comparison === "以上" ? t.duration >= seconds : comparison === "以下" ? t.duration <= seconds : comparison === "未満" || comparison === "より短い" ? t.duration < seconds : t.duration > seconds)) return false;
    }
    return true;
  });
  if (adding && query && selected.length > 1 && !/全|すべて|全部|一致|含む|歌い手|アーティスト|投稿者|の曲/.test(text)) {
    const exact = selected.filter(id => data.tracks[id].title === query);
    if (exact.length === 1) selected = exact;
    else throw Error(`「${query}」に${selected.length}曲が該当します。曲名を詳しく指定するか、「${query}」を含む全曲を追加、と指定してください`);
  }
  if (!selected.length) throw Error("条件に一致する曲がありません。データは変更しません。");
  if (adding) return replace(unique([...p.tracks, ...selected]), `${selected.length}曲をライブラリから追加`);
  if (moving && destination) return plan(`「${p.name}」から「${destination.name}」へ${selected.length}曲を移動：${selected.slice(0,5).map(id => data.tracks[id].title).join("、")}`, d => ({ ...d, playlists: d.playlists.map(x => x.id === p.id ? { ...x, tracks: x.tracks.filter(id => !selected.includes(id)) } : x.id === destination.id ? { ...x, tracks: unique([...x.tracks, ...selected]) } : x) }));
  return replace(deleting ? p.tracks.filter(id => !selected.includes(id)) : selected, deleting ? `${selected.length}曲をリストから削除（音声ファイルを保持）` : `条件に一致する${selected.length}曲を抽出`);
}
