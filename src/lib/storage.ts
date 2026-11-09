import { openDB } from "idb";
import { emptyData, validateBackup } from "./model";
import type { Data } from "../types";
let database: ReturnType<typeof openDB> | undefined;
const db = () =>
  (database ??= openDB("musicpleasure-v2", 2, {
    upgrade(db) {
      if (!db.objectStoreNames.contains("state")) db.createObjectStore("state");
    },
  }));
export async function readData() {
  const d = await db();
  let value = await d.get("state", "app");
  if (typeof sessionStorage !== "undefined") {
    const recovery = sessionStorage.getItem("musicpleasure-recovery");
    if (recovery) {
      try {
        const raw = JSON.parse(recovery);
        const restored = validateBackup(raw);
        restored.importJob = Array.isArray(raw.importJob) ? raw.importJob : [];
        await d.put("state", restored, "app");
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
          await (await db()).put("state", next, "app");
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
