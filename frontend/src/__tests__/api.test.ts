import "fake-indexeddb/auto";
import { afterEach, beforeEach, it, expect, vi } from "vitest";
import { useStore } from "../store";
import { api } from "../api";
beforeEach(() => {
  useStore.setState({
    loaded: false,
    settings: {
      ...useStore.getState().settings,
      apiUrl: "",
      token: "private-backend-token",
    },
  });
  vi.stubGlobal("location", { hostname: "totoro0419.github.io" });
});
afterEach(() => vi.unstubAllGlobals());
it("routes GitHub Pages searches to the public metadata service without sending a private backend token", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ items: [], provider: "test-fixture" }), {
        headers: { "Content-Type": "application/json" },
      }),
    );
  vi.stubGlobal("fetch", fetch);
  await api("/search?q=Song");
  expect(fetch.mock.calls[0][0]).toBe(
    "https://musicpleasure-search-ibuki.ibukioike2009.chatgpt.site/api/search?q=Song",
  );
  expect(fetch.mock.calls[0][1].headers.Authorization).toBeUndefined();
  await expect(api("/jobs", { method: "POST" })).rejects.toThrow(
    "フルバックエンド",
  );
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("preserves an explicitly configured full backend and its authentication", async () => {
  useStore.getState().settingsUpdate({ apiUrl: "https://private-api.example" });
  const fetch = vi
    .fn()
    .mockResolvedValue(
      new Response("{}", { headers: { "Content-Type": "application/json" } }),
    );
  vi.stubGlobal("fetch", fetch);
  await api("/search?q=Song");
  expect(fetch.mock.calls[0][0]).toBe(
    "https://private-api.example/api/search?q=Song",
  );
  expect(fetch.mock.calls[0][1].headers.Authorization).toBe(
    "Bearer private-backend-token",
  );
});
