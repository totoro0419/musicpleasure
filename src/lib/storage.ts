import { openDB } from "idb";
import { emptyData, validateBackup } from "./model";
import type { Data } from "../types";
const db = () =>
  openDB("musicpleasure-v2", 2, {
    upgrade(db) {
      if (!db.objectStoreNames.contains("state")) db.createObjectStore("state");
    },
  });
export async function readData() {
  const d = await db();
  const value = await d.get("state", "app");
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
