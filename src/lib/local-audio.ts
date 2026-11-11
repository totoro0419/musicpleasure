import type { Track } from "../types";
import { db } from "./storage";

export const MAX_AUDIO_BYTES = 128 * 1024 * 1024;
const types: Record<string, string> = { mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", ogg: "audio/ogg", opus: "audio/ogg", wav: "audio/wav", flac: "audio/flac", webm: "audio/webm", mp4: "audio/mp4" };
export function audioType(file: Pick<File, "name" | "type">) {
  return types[file.name.split(".").pop()?.toLowerCase() || ""] || (file.type.startsWith("audio/") ? file.type : "");
}
export async function capacity() {
  const estimate = await navigator.storage?.estimate?.().catch(() => undefined);
  const d = await db();
  const metas = await d.getAll("audioMeta") as Track[];
  return { bytes: metas.reduce((n, t) => n + (t.local?.bytes || 0), 0), count: metas.length,
    usage: estimate?.usage, quota: estimate?.quota, persistent: await navigator.storage?.persisted?.().catch(() => false) || false };
}
export function ensureCapacity(size: number, usage?: number, quota?: number) {
  if (quota && usage !== undefined && size > quota - usage)
    throw new DOMException("保存容量が不足しています。不要な音源を削除して再試行してください。", "QuotaExceededError");
}
export async function savedAudio(id: string): Promise<Blob | undefined> {
  return (await db()).get("audio", id);
}
export async function reconcileLocal(tracks: Record<string, Track>) {
  const d = await db();
  const tx = d.transaction(["audio", "audioMeta"], "readonly");
  const [keys, metas] = await Promise.all([tx.objectStore("audio").getAllKeys(), tx.objectStore("audioMeta").getAll()]);
  await tx.done;
  const files = new Set(keys);
  const merged = { ...tracks };
  for (const t of Object.values(merged)) if (t.source === "local" && t.local)
    merged[t.id] = { ...t, local: { ...t.local, available: files.has(t.id) } };
  for (const t of metas as Track[]) if (t.local) merged[t.id] = {
    ...t, ...merged[t.id], source: "local", local: { ...t.local, ...merged[t.id]?.local, available: files.has(t.id) },
  };
  return merged;
}
export async function putAudio(track: Track, blob: Blob) {
  const metadata = structuredClone(track);
  const d = await db();
  const tx = d.transaction(["audio", "audioMeta"], "readwrite");
  // Both records commit together; an aborted transaction leaves neither half behind.
  try {
    await Promise.all([tx.objectStore("audio").put(blob, track.id), tx.objectStore("audioMeta").put(metadata, track.id)]);
    await tx.done;
  } catch (e) { try { tx.abort(); } catch {} await tx.done.catch(() => {}); throw e; }
}
export async function deleteAudio(id: string) {
  const tx = (await db()).transaction(["audio", "audioMeta"], "readwrite");
  await Promise.all([tx.objectStore("audio").delete(id), tx.objectStore("audioMeta").delete(id)]);
  await tx.done;
}
async function tags(file: File): Promise<{ title?: string; artist?: string }> {
  const bytes = new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer());
  const result: { title?: string; artist?: string } = {};
  const ascii = (b: Uint8Array) => new TextDecoder("latin1").decode(b).replace(/\0/g, "").trim();
  if (ascii(bytes.slice(0, 3)) === "ID3" && [3, 4].includes(bytes[3])) {
    let offset = 10;
    while (offset + 10 <= bytes.length) {
      const name = ascii(bytes.slice(offset, offset + 4));
      const s = bytes.slice(offset + 4, offset + 8);
      const size = bytes[3] === 4 ? s.reduce((n, b) => n * 128 + (b & 127), 0) : s.reduce((n, b) => n * 256 + b, 0);
      if (!size || offset + 10 + size > bytes.length) break;
      if (["TIT2", "TPE1"].includes(name)) {
        const raw = bytes.slice(offset + 10, offset + 10 + size);
        const encoding = raw[0] === 1 ? "utf-16" : raw[0] === 2 ? "utf-16be" : raw[0] === 3 ? "utf-8" : "latin1";
        try { result[name === "TIT2" ? "title" : "artist"] = new TextDecoder(encoding).decode(raw.slice(1)).replace(/\0/g, "").trim(); } catch {}
      }
      offset += 10 + size;
    }
  }
  const end = new Uint8Array(await file.slice(-128).arrayBuffer());
  if (ascii(end.slice(0, 3)) === "TAG") {
    result.title ||= ascii(end.slice(3, 33)); result.artist ||= ascii(end.slice(33, 63));
  }
  return result;
}
export async function inspectAudio(file: File, signal?: AbortSignal) {
  const mime = audioType(file);
  if (!mime) throw Error("音声ファイルを選択してください（MP3 / M4A / AAC / Ogg / WAV / FLAC / WebM）");
  if (!file.size || file.size > MAX_AUDIO_BYTES) throw Error("空でない128MB以下の音声を選択してください");
  signal?.throwIfAborted();
  const audio = new Audio();
  if (!audio.canPlayType(mime)) throw Error(`このブラウザでは${mime}を再生できません`);
  const url = URL.createObjectURL(file);
  try {
    const duration = await new Promise<number>((resolve, reject) => {
      const done = (error?: unknown) => {
        clearTimeout(timer); signal?.removeEventListener("abort", cancel);
        audio.onloadeddata = null; audio.onerror = null;
        error ? reject(error) : resolve(audio.duration);
      };
      const cancel = () => done(signal?.reason);
      const timer = setTimeout(() => done(Error("音声の確認がタイムアウトしました")), 10000);
      audio.onloadeddata = () => Number.isFinite(audio.duration) && audio.duration > 0 ? done() : done(Error("再生時間を読み取れません"));
      audio.onerror = () => done(Error("音声をデコードできません。形式やファイルを確認してください"));
      signal?.addEventListener("abort", cancel, { once: true });
      audio.preload = "auto"; audio.src = url; audio.load();
    });
    signal?.throwIfAborted();
    const [hashBuffer, metadata] = await Promise.all([crypto.subtle.digest("SHA-256", await file.arrayBuffer()), tags(file)]);
    signal?.throwIfAborted();
    const hash = Array.from(new Uint8Array(hashBuffer), n => n.toString(16).padStart(2, "0")).join("");
    const basename = file.name.replace(/\.[^.]+$/, "");
    const parts = basename.split(/\s+[–—-]\s+/);
    const track: Track = { id: "local-" + hash, source: "local", title: metadata.title || (parts.length > 1 ? parts.slice(1).join(" - ") : basename),
      uploader: metadata.artist || (parts.length > 1 ? parts[0] : "アーティスト未登録"), duration, thumbnail: "",
      local: { hash, filename: file.name, bytes: file.size, mime, added: Date.now(), available: true } };
    return track;
  } finally { audio.pause(); audio.removeAttribute("src"); audio.load(); URL.revokeObjectURL(url); }
}
export async function importAudio(file: File, signal?: AbortSignal) {
  const track = await inspectAudio(file, signal);
  if (await savedAudio(track.id)) return { track, duplicate: true };
  const { usage, quota } = await capacity();
  ensureCapacity(file.size, usage, quota);
  signal?.throwIfAborted();
  try { await putAudio(track, file.slice(0, file.size, track.local!.mime)); }
  catch (e) { if ((e as DOMException).name === "QuotaExceededError") throw Error("保存容量が不足しています。保存済みの音源は保持しました。"); throw e; }
  return { track, duplicate: false };
}
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
}
