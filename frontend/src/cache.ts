import { db } from './db';
import type { Track, AudioAsset } from './types';
export const CACHE_LIMIT = 512 * 1024 * 1024;
export const sourceKey = (s: Track['sources'][number]) =>
  s.provider === 'youtube' && s.videoId ? `youtube:${s.videoId}` : s.id;
async function digest(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  if (crypto.subtle) {
    const bytes = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./hash.worker.ts', import.meta.url), {type:'module'});
    worker.onmessage = e => {
      worker.terminate();
      e.data.hash ? resolve(e.data.hash) : reject(new Error('音声の整合性を確認できませんでした'));
    };
    worker.onerror = () => { worker.terminate(); reject(new Error('音声の整合性を確認できませんでした')); };
    worker.postMessage(buffer, [buffer]);
  });
}
export async function validateMP3(blob: Blob) {
  if (!blob.size || blob.size > 150 * 1024 * 1024) throw new Error('音声ファイルのサイズが不正です');
  const h = new Uint8Array(await blob.slice(0, 4096).arrayBuffer());
  const frame = h.some((b, i) => b === 255 && (h[i + 1] & 0xe0) === 0xe0 && (h[i + 1] & 6) !== 0);
  if (!(h[0] === 73 && h[1] === 68 && h[2] === 51) && !frame)
    throw new Error('有効なMP3音源ではありません');
}
export async function cachedAudio(track: Track): Promise<Blob | undefined> {
  for (const source of track.sources) {
    const key = sourceKey(source);
    const asset = await db.assets.get(key) || (key !== source.id ? await db.assets.get(source.id) : undefined);
    if (!asset) continue;
    // A storage/migration failure must never delete a valid older asset.
    let corrupt = !asset.blob || asset.bytes !== asset.blob.size;
    if (!corrupt) {
      try { await validateMP3(asset.blob); } catch { corrupt = true; }
    }
    const hash = corrupt ? '' : await digest(asset.blob);
    if (corrupt || (asset.sha256 && asset.sha256 !== hash)) {
      await db.assets.delete(asset.id);
      continue;
    }
    if (!asset.sha256 || asset.id !== key) {
      try {
        await db.transaction('rw', db.assets, async () => {
          await db.assets.put({ ...asset, id: key, sourceId: key, sha256: hash });
          if (asset.id !== key) await db.assets.delete(asset.id);
        });
      } catch { /* Keep the validated legacy MP3 playable if migration cannot be written. */ }
    }
    return asset.blob;
  }
}
export async function storeAudio(id: string, blob: Blob) {
  await validateMP3(blob);
  const sha256 = await digest(blob);
  const estimate = await navigator.storage?.estimate?.();
  if (estimate?.quota && (estimate.usage || 0) + blob.size > estimate.quota * .95)
    throw new Error('端末の空き容量が不足しています。保存管理で不要なMP3を削除してください');
  await db.transaction('rw', db.assets, async () => {
    const all = await db.assets.toArray();
    const used = all.filter(a => a.id !== id).reduce((n, a) => n + a.bytes, 0);
    if (used + blob.size > CACHE_LIMIT)
      throw new Error('MP3保存上限（512MB）です。保存管理で不要な音源を削除してください');
    const asset: AudioAsset = { id, sourceId: id, blob, bytes: blob.size, sha256, createdAt: Date.now() };
    await db.assets.put(asset);
  });
}
