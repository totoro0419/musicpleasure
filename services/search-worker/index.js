// Public, read-only metadata API. No audio files, library data, or credentials.
const origins = new Set([
  "https://totoro0419.github.io",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);
const recent = new Map();
const cache = new Map();
function text(value) {
  return (
    value?.simpleText || value?.runs?.map((run) => run.text).join("") || ""
  );
}
export function extractData(html, name = "ytInitialData") {
  const marker = new RegExp("(?:var\\s+)?" + name + "\\s*=\\s*").exec(html);
  if (!marker) throw new Error("YouTubeから検索データを取得できませんでした");
  const start = html.indexOf("{", marker.index + marker[0].length);
  let depth = 0,
    quoted = false,
    escaped = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') quoted = false;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0)
      return JSON.parse(html.slice(start, i + 1));
  }
  throw new Error("YouTubeの検索データが途中で終了しました");
}
function classify(title) {
  const rules = [
    ["live", /\blive\b|ライブ|ライヴ/i],
    ["cover", /\bcover\b|歌ってみた/i],
    ["remix", /\bremix\b|リミックス/i],
    ["mv", /\bMV\b|music video/i],
    ["audio", /official audio|audio only/i],
  ];
  return rules.find(([, pattern]) => pattern.test(title))?.[0] || "unknown";
}
export function tracksFromData(data) {
  const found = new Map();
  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (node.videoRenderer) {
      const v = node.videoRenderer,
        id = v.videoId,
        title = text(v.title);
      if (/^[\w-]{11}$/.test(id || "") && title) {
        const kind = classify(title),
          duration = text(v.lengthText)
            .split(":")
            .reduce((n, p) => n * 60 + (Number(p) || 0), 0);
        found.set(id, {
          id: "yt:" + id,
          title,
          artist:
            text(v.ownerText || v.longBylineText || v.shortBylineText) ||
            "未確認",
          duration,
          thumbnail: v.thumbnail?.thumbnails?.at(-1)?.url || "",
          sources: [
            {
              id: "youtube:" + id,
              provider: "youtube",
              videoId: id,
              url: "https://www.youtube.com/watch?v=" + id,
              kind,
              evidence:
                kind === "unknown"
                  ? "未確認"
                  : "タイトル表記による分類（公式性は未確認）",
              official: false,
            },
          ],
        });
      }
      return;
    }
    for (const [key, value] of Object.entries(node))
      if (!/^(adSlotRenderer|promoted.*|playerAds|adPlacements)$/i.test(key))
        visit(value);
  }
  visit(data.contents?.twoColumnSearchResultsRenderer?.primaryContents || data);
  return [...found.values()].slice(0, 25);
}
function json(request, body, status = 200) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    Vary: "Origin",
  };
  const origin = request.headers.get("origin");
  if (origins.has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  headers["Access-Control-Allow-Methods"] = "GET, OPTIONS";
  headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization";
  return new Response(JSON.stringify(body), { status, headers });
}
export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return json(request, {});
    if (request.method !== "GET")
      return json(
        request,
        {
          detail:
            "この接続先は検索専用です。音声取得にはフルバックエンドを接続してください",
        },
        503,
      );
    if (url.pathname === "/api/health")
      return json(request, {
        status: "ok",
        youtubeApi: false,
        ai: false,
        ffmpeg: false,
        downloader: false,
        authentication: false,
        capabilities: { search: true, downloads: false, ai: false },
      });
    if (url.pathname !== "/api/search")
      return json(
        request,
        {
          detail:
            "この接続先は検索専用です。必要に応じてフルバックエンドを接続してください",
        },
        503,
      );
    const q = (url.searchParams.get("q") || "").trim(),
      kind = url.searchParams.get("kind") || "all";
    if (!q || q.length > 300)
      return json(
        request,
        { detail: "検索語は1〜300文字で入力してください" },
        400,
      );
    if (
      !["all", "audio", "mv", "live", "cover", "remix", "unknown"].includes(
        kind,
      )
    )
      return json(request, { detail: "無効な分類です" }, 400);
    if (url.searchParams.get("page"))
      return json(
        request,
        {
          detail: "さらに結果を取得するにはフルバックエンドを接続してください",
        },
        400,
      );
    const ip = request.headers.get("cf-connecting-ip") || "anonymous",
      now = Date.now();
    const bucket = (recent.get(ip) || []).filter((t) => t > now - 60000);
    if (bucket.length >= 30)
      return json(
        request,
        { detail: "検索回数の上限です。1分後に再試行してください" },
        429,
      );
    bucket.push(now);
    recent.set(ip, bucket);
    if (recent.size > 2000) recent.delete(recent.keys().next().value);
    const key = q + "|" + kind,
      hit = cache.get(key);
    if (hit && hit.until > now) return json(request, hit.data);
    try {
      const target = new URL("https://www.youtube.com/results");
      target.searchParams.set("search_query", q);
      target.searchParams.set("hl", "ja");
      const response = await fetch(target, {
        headers: { Accept: "text/html", "Accept-Language": "ja-JP,ja;q=0.9" },
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok)
        return json(
          request,
          { detail: "YouTubeへの接続に失敗しました (" + response.status + ")" },
          502,
        );
      const html = await response.text();
      let items = tracksFromData(extractData(html));
      if (kind !== "all")
        items = items.filter((t) => t.sources[0].kind === kind);
      const data = {
        items,
        nextPageToken: "",
        provider: "youtube-web-metadata",
      };
      cache.set(key, { data, until: now + 10 * 60000 });
      if (cache.size > 100) cache.delete(cache.keys().next().value);
      return json(request, data);
    } catch (error) {
      return json(
        request,
        {
          detail:
            error.name === "TimeoutError"
              ? "YouTube検索がタイムアウトしました。再試行してください"
              : "YouTubeから検索結果を取得できませんでした。時間をおいて再試行してください",
        },
        502,
      );
    }
  },
};
