import Fuse from "fuse.js";
import { toHiragana, toRomaji } from "wanakana";
import type { Track } from "./types";
import { normalized } from "./types";
const canonical = (v: string) =>
  normalized(toHiragana(v.normalize("NFKC").toLowerCase()));
export function localSearch(tracks: Track[], query: string): Track[] {
  const q = query.trim();
  if (!q) return tracks;
  const direct = tracks.filter(
    (t) =>
      canonical(t.title + t.artist).includes(canonical(q)) ||
      normalized(toRomaji(t.title + t.artist)).includes(normalized(q)),
  );
  const ids = new Set(direct.map((t) => t.id));
  const fuzzy = new Fuse(tracks, {
    keys: ["title", "artist"],
    threshold: 0.3,
    ignoreLocation: true,
    minMatchCharLength: 2,
  })
    .search(q, { limit: 8 })
    .map((v) => v.item)
    .filter((t) => !ids.has(t.id));
  return [...direct, ...fuzzy];
}
