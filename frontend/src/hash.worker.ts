import { sha256 } from "@noble/hashes/sha2.js";
self.onmessage = (e: MessageEvent<ArrayBuffer>) => {
  try {
    const digest = sha256(new Uint8Array(e.data));
    self.postMessage({
      hash: Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join(""),
    });
  } catch {
    self.postMessage({ error: "音声ファイルを解析できませんでした" });
  }
};
