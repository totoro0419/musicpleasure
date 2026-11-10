import { afterEach, expect, it, vi } from "vitest";
import { emptyData, placeholder } from "./model";

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); vi.clearAllMocks(); });

it("retrying an errored player goes through queue traversal and reaches the following playable song", async () => {
  vi.resetModules();
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("navigator", {});
  const first = placeholder("M7lc1UVf-VE"), next = placeholder("dQw4w9WgXcQ");
  const playback = {
    status: "error", engine: "invidious", position: 0, duration: 100,
    message: "Failed", trackId: first.id, instance: "https://api.test",
  };
  const fake: any = {
    state: playback, play: vi.fn(), pause: vi.fn(), prefetch: vi.fn(),
    onState: () => {},
    load: vi.fn(async (track) => {
      if (track.id === first.id) return {
        status: "failed", error: { kind: "upstream_rejected", message: "拒否" },
      };
      fake.onState({ ...playback, trackId: track.id, status: "playing" });
      return { status: "playing" };
    }),
  };
  vi.doMock("./player", () => ({ player: fake }));
  vi.doMock("./storage", () => ({ readData: async () => emptyData(), saveData: vi.fn(async () => {}) }));
  vi.doMock("./invidious", () => ({ invidious: { init: vi.fn(), onHealth: () => {}, preferred: "" } }));
  vi.doMock("./reliability", () => ({
    reliability: { init: vi.fn(), isExcluded: () => false, record: vi.fn() },
    classify: (e: unknown) => e,
  }));
  const { store } = await import("./store");
  await store.init();
  store.update((d) => ({ ...d, queue: [first.id, next.id], current: 0,
    tracks: { [first.id]: first, [next.id]: next } }));
  store.toggle();
  await vi.waitFor(() => expect(store.playback.trackId).toBe(next.id));
  expect(fake.play).not.toHaveBeenCalled();
  expect(fake.load.mock.calls.map((args: any[]) => args[0].id)).toEqual([first.id, next.id]);
  expect(store.playback.status).toBe("playing");
});
