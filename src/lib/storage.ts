import { openDB } from "idb";
import { emptyData, validateBackup } from "./model";
import type { Data } from "../types";
let database: ReturnType<typeof openDB> | undefined;
let expectedRevision: number | undefined;
export const storageRevision = () => expectedRevision;
export const db = () =>
  (database ??= openDB("musicpleasure-v2", 3, {
    upgrade(db) {
      if (!db.objectStoreNames.contains("state")) db.createObjectStore("state");
      if (!db.objectStoreNames.contains("audio")) db.createObjectStore("audio");
      if (!db.objectStoreNames.contains("audioMeta")) db.createObjectStore("audioMeta");
    },
  }));
export async function readData() {
  const d = await db();
  const reading = d.transaction("state", "readonly");
  const [saved, revision] = await Promise.all([reading.store.get("app"), reading.store.get("revision")]);
  await reading.done;
  let value = saved;
  expectedRevision = Number(revision) || 0;
  if (typeof sessionStorage !== "undefined") {
    const recovery = sessionStorage.getItem("musicpleasure-recovery");
    if (recovery) {
      try {
        const raw = JSON.parse(recovery);
        if ((raw.__revision ?? 0) !== expectedRevision) {
          sessionStorage.removeItem("musicpleasure-recovery");
          throw Error("古い復旧データを採用せず、最新の保存内容を維持しました");
        }
        const restored = validateBackup(raw);
        restored.importJob = Array.isArray(raw.importJob) ? raw.importJob : [];
        restored.playlistImport = raw.playlistImport;
        const tx = d.transaction("state", "readwrite");
        const revision = Number(await tx.store.get("revision")) || 0;
        if (revision !== expectedRevision) { await tx.done; throw Error("別のタブが保存しました"); }
        await tx.store.put(restored, "app");
        await tx.store.put(revision + 1, "revision");
        await tx.done;
        expectedRevision = revision + 1;
        value = restored;
        sessionStorage.removeItem("musicpleasure-recovery");
      } catch {
        /* Preserve the durable original when recovery data is invalid. */
      }
    }
  }
  if (!value) return emptyData();
  const clean = validateBackup(value);
  clean.importJob = Array.isArray(value.importJob) ? value.importJob : [];
  if (value.playlistImport?.id && Array.isArray(value.playlistImport.tracks) && Array.isArray(value.playlistImport.pages)) {
    clean.playlistImport = { ...value.playlistImport, status: value.playlistImport.status === "fetching" ? "paused" : value.playlistImport.status };
  }
  return clean;
}
let pending: Data | undefined;
let running: Promise<void> | undefined;
export function saveData(data: Data): Promise<void> {
  pending = structuredClone(data);
  if (!running)
    running = (async () => {
      try {
        while (pending) {
          const next = pending;
          pending = undefined;
          const tx = (await db()).transaction("state", "readwrite");
          const actual = Number(await tx.store.get("revision")) || 0;
          if (expectedRevision !== undefined && actual !== expectedRevision) {
            await tx.done;
            throw Error("別のタブでライブラリが変更されました。上書きを停止しました。この画面の必要なデータをJSONに書き出してから再読み込みしてください。");
          }
          await tx.store.put(next, "app");
          await tx.store.put(actual + 1, "revision");
          await tx.done;
          expectedRevision = actual + 1;
        }
      } finally {
        running = undefined;
      }
    })();
  return running;
}
export async function healthRead() {
  return await (await db()).get("state", "health");
}
export async function healthSave(v: unknown) {
  await (await db()).put("state", v, "health");
}

export async function runtimeRead(key: string) {
  return (await db()).get("state", key);
}
export async function runtimeSave(key: string, value: unknown) {
  await (await db()).put("state", value, key);
}
