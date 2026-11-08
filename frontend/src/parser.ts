import type { ImportRow } from "./types";
export const normalize = (s: string) =>
  s.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
function csv(line: string) {
  const values: string[] = [];
  let v = "",
    quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') {
        v += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === "," && !quoted) {
      values.push(v.trim());
      v = "";
    } else v += c;
  }
  values.push(v.trim());
  return values;
}
export function parseImport(text: string): ImportRow[] {
  if (text.length > 1000000) throw new Error("入力は1MB以下にしてください");
  let objects: unknown[] | undefined;
  try {
    const json = JSON.parse(text);
    objects = Array.isArray(json)
      ? json
      : json.tracks || json.songs || json.items;
  } catch {
    /* not JSON */
  }
  const rows: ImportRow[] = [];
  const seen = new Set<string>();
  const add = (
    title: string,
    artist = "",
    url?: string,
    raw = title,
    warning?: string,
  ) => {
    title = title.trim();
    artist = artist.trim();
    if (!title && !url) return;
    const k = normalize(url || `${artist}|${title}`);
    const duplicate = seen.has(k);
    seen.add(k);
    rows.push({
      id: `row-${rows.length}`,
      title,
      artist,
      url,
      raw,
      warning: duplicate ? "入力内で重複しています" : warning,
      skip: duplicate,
    });
  };
  if (objects) {
    for (const o of objects) {
      if (typeof o === "string") {
        for (const r of parseImport(o))
          add(r.title, r.artist, r.url, r.raw, r.warning);
      } else if (o && typeof o === "object") {
        const v = o as Record<string, unknown>;
        add(
          String(v.title || v.track || v.song || v["曲名"] || ""),
          String(v.artist || v["アーティスト"] || ""),
          typeof v.url === "string" ? v.url : undefined,
          JSON.stringify(v),
        );
      }
    }
    return rows.slice(0, 500);
  }
  let columns: string[] | undefined, mode: "table" | "csv" | undefined;
  for (const raw of text.split(/\r?\n/)) {
    let line = raw
      .trim()
      .replace(/^\s*(?:[-*+]\s+|\d+[.)、]\s*)/, "")
      .replace(/\*\*|__/g, "");
    if (!line || /^```|^#{1,6}\s|^[|:\s-]+$/.test(line)) continue;
    const url = line.match(
      /https?:\/\/(?:www\.|m\.|music\.)?(?:youtube\.com\/(?:watch\?[^\s)>]+|shorts\/[^\s)>]+|playlist\?[^\s)>]+)|youtu\.be\/[^\s)>]+)/,
    )?.[0];
    if (url) {
      add("", "", url, raw);
      continue;
    }
    const cells = line.includes("|")
      ? line
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((v) => v.trim())
      : line.includes(",")
        ? csv(line)
        : null;
    if (cells) {
      if (
        cells.some((c) =>
          /^(title|song|track|曲名|楽曲名|artist|アーティスト|歌手)$/i.test(c),
        )
      ) {
        columns = cells.map((c) => c.toLowerCase());
        mode = line.includes("|") ? "table" : "csv";
        continue;
      }
      if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
      const titleIndex =
        columns?.findIndex((c) => /^(title|song|track|曲名|楽曲名)$/.test(c)) ??
        -1;
      const artistIndex =
        columns?.findIndex((c) => /^(artist|アーティスト|歌手)$/.test(c)) ?? -1;
      add(
        cells[titleIndex >= 0 ? titleIndex : 1] || cells[0],
        cells[artistIndex >= 0 ? artistIndex : 0] || "",
        undefined,
        raw,
        columns
          ? undefined
          : "列の順番を「アーティスト, 曲名」として解釈しました",
      );
      continue;
    }
    if (mode && line.startsWith("|")) continue;
    const pair = line.match(/^(.+?)\s+[-–—－]\s+(.+)$/);
    if (pair) {
      add(pair[2], pair[1], undefined, raw);
      continue;
    }
    const quoted = line.match(
      /[「『"]([^」』"]+)[」』"](?:\s*[-–—／/]\s*|\s*by\s+)([^。、]+)|([^。、]+?)の[「『]([^」』]+)[」』]/i,
    );
    if (quoted) {
      add(
        quoted[1] || quoted[4],
        quoted[2] || quoted[3],
        undefined,
        raw,
        "文章から抽出しました。候補を確認してください",
      );
      continue;
    }
    add(line, "", undefined, raw, "アーティスト未指定。曲名として検索します");
  }
  return rows.slice(0, 500);
}
