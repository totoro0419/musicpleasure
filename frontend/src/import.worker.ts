import { parseImport } from "./parser";
self.onmessage = (event: MessageEvent<string>) => {
  try {
    self.postMessage({ rows: parseImport(event.data) });
  } catch (e) {
    self.postMessage({
      error: e instanceof Error ? e.message : "解析に失敗しました",
    });
  }
};
