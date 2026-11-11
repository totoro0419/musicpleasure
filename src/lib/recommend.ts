import type { Data, Track, RadioMode } from "../types";
import { fromItem } from "./model";
import { invidious } from "./invidious";
import { reliability } from "./reliability";
export const isCover = (s: string) =>
  /歌ってみた|cover|カバー|歌いました|歌わせて/i.test(s);
export const words = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .replace(/【[^】]*】|\[[^\]]*\]/g, " ")
      .split(/[\s\-–—|/「」『』（）()、,]+/)
      .filter((x) => x.length > 1),
  );
function songTitle(title: string, uploader: string) {
  let core = title.normalize("NFKC")
    .replace(/【[^】]*】|\[[^\]]*\]/g, " ")
    .replace(/\([^)]*(?:cover|歌ってみた|カバー|official|remix|version|ライブ|live)[^)]*\)/gi, " ")
    .split(/[|/]|\s+(?:covered by|cover by|歌ってみた|カバー)\b/i)[0]
    .replace(/cover|歌ってみた|カバー/gi, " ")
    .trim();
  const parts = core.split(/\s+[-–—]\s+/);
  if (parts.length > 1 && parts[0].toLowerCase() === uploader.toLowerCase()) core = parts[1];
  return core.trim() || title;
}
function songKey(title: string) {
  return title.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}
export function rankCandidates(
  candidates: Track[],
  seed: Track,
  data: Data,
  mode: RadioMode = data.settings.radioMode,
) {
  const seedWords = words(seed.title),
    favoriteChannels = new Set(
      data.favorites.map((id) => data.tracks[id]?.uploader),
    ),
    weights = data.settings.weights;
  const seedSong = songKey(songTitle(seed.title, seed.uploader));
  const excluded = new Set([...data.queue, ...data.disliked, seed.id]);
  return [...new Map(candidates.map((t) => [t.id, t])).values()]
    .filter((t) => !excluded.has(t.id) && !reliability.isExcluded(t.id))
    .filter((t) => {
      if (mode !== "versions") return true;
      const song = songKey(songTitle(t.title, t.uploader));
      return !!seedSong && (song === seedSong || (seedSong.length >= 3 && song.includes(seedSong)));
    })
    .filter(t => mode !== "covers" || isCover(t.title))
    .filter(t => mode !== "channel" || (t.uploaderUrl && seed.uploaderUrl ? t.uploaderUrl === seed.uploaderUrl : !!seed.uploader && t.uploader === seed.uploader))
    .map((t) => {
      let score = 0;
      const reasons: string[] = [];
      const listening = data.listening[t.id];
      const overlap = [...words(t.title)].filter((w) =>
        seedWords.has(w),
      ).length;
      score += weights.related * (overlap + 1);
      if (data.favorites.includes(t.id)) { score += weights.favorite * (mode === "favorites" ? 10 : 4); reasons.push("お気に入りの曲"); }
      const additions = data.additions?.[t.id] || data.playlists.filter(p => p.tracks.includes(t.id)).length;
      if (additions) { score += Math.min(8, additions * 2); reasons.push("プレイリストに追加した曲"); }
      if (overlap) reasons.push("現在の曲に関連");
      if (favoriteChannels.has(t.uploader)) {
        score += weights.favorite * 3;
        reasons.push("よく聴く歌い手");
      }
      if (data.channels.includes(t.uploaderUrl || "")) {
        score += weights.favorite * 4;
        reasons.push("保存したチャンネル");
      }
      score -= (listening?.failed || 0) * 12;
      if (!listening?.plays) {
        score +=
          weights.fresh * (data.settings.discovery / 30) +
          (mode === "discovery" ? 15 : 0);
        reasons.push("まだ聴いていない曲");
      } else {
        score += Math.min(8, listening.seconds / 600) + Math.min(6, listening.plays) - listening.skips * 4;
      }
      if (listening?.last && Date.now() - listening.last < 86400000) score -= weights.recent * 3;
      const recent = data.history.indexOf(t.id);
      if (recent >= 0 && recent < 10) score -= weights.recent * (10 - recent) / 4;
      score -= (listening?.skips || 0) * (listening?.plays ? 0 : 4);
      if (t.duration > 900) score -= 15;
      if (/解説|実況|ニュース|雑談|reaction|tutorial/i.test(t.title))
        score -= 25;
      if (isCover(t.title)) {
        score += mode === "covers" ? 35 : 3;
        reasons.push("歌ってみた・カバー");
      }
      if (mode === "channel" && t.uploader === seed.uploader) {
        score += 45;
        reasons.unshift("同じ歌い手の別の曲");
      }
      if (mode === "versions") {
        score += overlap * 10;
        reasons.unshift("同じ曲の別バージョン候補");
      }
      if (mode === "favorites" && favoriteChannels.has(t.uploader)) score += 20;
      return {
        ...t,
        score,
        reason: reasons.slice(0, 2).join(" / ") || "関連動画から発見",
      };
    })
    .sort((a, b) => b.score - a.score)
    .filter(
      (t, i, a) =>
        i < 2 || a[i - 1].uploader !== t.uploader || mode === "channel",
    )
    .slice(0, 15);
}
export async function recommend(seed: Track, data: Data, signal?: AbortSignal) {
  const pool: Track[] = Object.values(data.tracks).filter(t => !data.disliked.includes(t.id) && (navigator.onLine !== false || (t.source === "local" && t.local?.available)));
  if (navigator.onLine === false) return rankCandidates(pool, seed, data);
  const mode = data.settings.radioMode;
  const core = songTitle(seed.title, seed.uploader);
  const query = mode === "channel"
    ? `${seed.uploader} 音楽`
    : mode === "covers" || mode === "versions"
      ? `${core} 歌ってみた cover`
      : `${core} music`;
  const search = async (term: string) => {
    const result = await invidious.search(term, undefined, signal);
    return result.items.map(fromItem).filter((t): t is Track => !!t);
  };
  const related = async () => {
    if (seed.source === "local") return [];
    const info = await invidious.streams(seed.id, signal);
    return info.relatedStreams.map(fromItem).filter((t): t is Track => !!t);
  };
  const sources = await Promise.allSettled([
    related(),
    mode === "channel" && seed.uploaderUrl ? invidious.channel(seed.uploaderUrl, signal) : search(query),
  ]);
  signal?.throwIfAborted();
  let errors = 0;
  for (const result of sources) {
    if (result.status === "fulfilled") pool.push(...result.value);
    else errors++;
  }
  let ranked = rankCandidates(pool, seed, data);
  if (ranked.length < 4 && !signal?.aborted) {
    try {
      pool.push(...await search(mode === "versions" ? `${core} acoustic live remix` : `${seed.uploader || core} ${mode === "covers" ? "歌ってみた" : "音楽"}`));
      ranked = rankCandidates(pool, seed, data);
    } catch { errors++; }
  }
  signal?.throwIfAborted();
  if (!ranked.length && errors)
    throw Error("推薦候補を取得できません。接続回復後に再試行してください。");
  return ranked;
}
