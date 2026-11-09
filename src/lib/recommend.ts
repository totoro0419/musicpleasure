import type { Data, Track, RadioMode } from "../types";
import { fromItem, unique } from "./model";
import { piped } from "./piped";
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
  const excluded = new Set([...data.queue, ...data.disliked, seed.id]);
  return unique(candidates.map((t) => t.id))
    .map((id) => candidates.find((t) => t.id === id)!)
    .filter((t) => !excluded.has(t.id))
    .map((t) => {
      let score = 0;
      const reasons: string[] = [];
      const listening = data.listening[t.id];
      const overlap = [...words(t.title)].filter((w) =>
        seedWords.has(w),
      ).length;
      score += weights.related * (overlap + 1);
      if (overlap) reasons.push("現在の曲に関連");
      if (favoriteChannels.has(t.uploader)) {
        score += weights.favorite * 3;
        reasons.push("よく聴く歌い手");
      }
      if (data.channels.includes(t.uploaderUrl || "")) {
        score += weights.favorite * 4;
        reasons.push("保存したチャンネル");
      }
      if (!listening?.plays) {
        score +=
          weights.fresh * (data.settings.discovery / 30) +
          (mode === "discovery" ? 15 : 0);
        reasons.push("まだ聴いていない曲");
      } else {
        score +=
          Math.min(8, listening.seconds / 600) -
          listening.skips * 4 -
          listening.failed * 12;
        if (Date.now() - listening.last < 86400000) score -= weights.recent * 3;
      }
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
        if (t.uploader !== seed.uploader && overlap)
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
  const pool: Track[] = [];
  let errors = 0;
  try {
    const info = await piped.streams(seed.id, signal);
    pool.push(
      ...info.relatedStreams.map(fromItem).filter((t): t is Track => !!t),
    );
  } catch {
    errors++;
  }
  if (signal?.aborted) return [];
  const mode = data.settings.radioMode;
  const core = seed.title
    .replace(/【[^】]*】|\[[^\]]*\]|歌ってみた|cover|カバー/gi, " ")
    .split(/[|／]/)[0]
    .trim();
  const query =
    mode === "channel"
      ? `${seed.uploader} 音楽`
      : mode === "covers" || mode === "versions"
        ? `${core} 歌ってみた cover`
        : `${core} music`;
  try {
    if (mode === "channel" && seed.uploaderUrl)
      pool.push(...(await piped.channel(seed.uploaderUrl, signal)));
    else {
      const r = await piped.search(query, undefined, signal);
      pool.push(...r.items.map(fromItem).filter((t): t is Track => !!t));
    }
  } catch {
    errors++;
  }
  pool.push(...data.favorites.map((id) => data.tracks[id]).filter(Boolean));
  const ranked = rankCandidates(pool, seed, data);
  if (!ranked.length && errors)
    throw Error("推薦候補を取得できません。接続回復後に再試行してください。");
  return ranked;
}
