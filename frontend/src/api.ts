import { useStore } from "./store";
import type { Track, DownloadJob, Proposal } from "./types";
export function base() {
  return useStore.getState().settings.apiUrl.replace(/\/$/, "");
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const { token } = useStore.getState().settings;
  const r = await fetch(base() + "/api" + path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
    signal: options.signal || AbortSignal.timeout(65000),
  });
  if (!r.ok) {
    let msg = `接続エラー (${r.status})`;
    try {
      const v = await r.json();
      msg = typeof v.detail === "string" ? v.detail : msg;
    } catch {
      if (!base() && [404, 500].includes(r.status)) {
        msg = path.startsWith("/search")
          ? "検索サーバーが未接続です。接続設定が完了するまでYouTube検索は利用できません"
          : "バックエンドが未接続です。設定からAPI URLを指定してください";
      }
    }
    throw new Error(msg);
  }
  const type = r.headers.get("Content-Type") || "";
  if (!type.includes("json"))
    throw new Error(
      "バックエンド未接続です。設定からAPI URLを指定してください",
    );
  return r.json();
}
export const search = (
  q: string,
  page = "",
  kind = "all",
  signal?: AbortSignal,
) =>
  api<{ items: Track[]; nextPageToken: string; provider: string }>(
    `/search?${new URLSearchParams({ q, page, kind })}`,
    { signal },
  );
export const jobs = () => api<DownloadJob[]>("/jobs");
export const createJob = (videoId: string) =>
  api<DownloadJob>("/jobs", {
    method: "POST",
    body: JSON.stringify({ videoId }),
  });
export const assistant = (prompt: string, tracks: Track[]) =>
  api<Proposal>("/assistant", {
    method: "POST",
    body: JSON.stringify({ prompt, tracks }),
  });
export async function fetchAudio(id: string) {
  const token = useStore.getState().settings.token;
  const r = await fetch(base() + `/api/assets/${id}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal: AbortSignal.timeout(120000),
  });
  if (!r.ok) throw new Error("音声ファイルを保存できませんでした");
  const blob = await r.blob();
  if (!blob.size || !r.headers.get("content-type")?.includes("audio/"))
    throw new Error("有効な音声ファイルが返されませんでした");
  return blob;
}
