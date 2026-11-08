import "fake-indexeddb/auto";
import {
  beforeAll,
  beforeEach,
  afterEach,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { db } from "../db";
import { useStore } from "../store";
import type { Track, AudioAsset } from "../types";
const handlers = new Map<string, () => void>();
class FakeAudio extends EventTarget {
  src = "";
  preload = "";
  hidden = false;
  dataset = {};
  volume = 1;
  paused = true;
  currentTime = 0;
  duration = 8;
  playCalls = 0;
  onloadedmetadata: (() => void) | null = null;
  async play() {
    this.playCalls++;
    this.paused = false;
    this.dispatchEvent(new Event("playing"));
  }
  pause() {
    this.paused = true;
    this.dispatchEvent(new Event("pause"));
  }
  removeAttribute(name: string) {
    if (name === "src") this.src = "";
  }
  load() {}
}
const track: Track = {
  id: "local:test",
  title: "Test",
  artist: "Artist",
  duration: 8,
  thumbnail: "",
  sources: [
    {
      id: "local:test",
      provider: "local",
      url: "",
      kind: "local",
      official: false,
      evidence: "test fixture",
    },
  ],
};
const asset: AudioAsset = {
  id: "local:test",
  sourceId: "local:test",
  blob: new Blob(["mp3"]),
  bytes: 3,
  createdAt: 0,
};
let player: typeof import("../player");
beforeAll(async () => {
  vi.stubGlobal("Audio", FakeAudio);
  vi.stubGlobal("document", { body: { append() {} } });
  vi.stubGlobal("navigator", {
    mediaSession: {
      setActionHandler(action: string, handler: () => void) {
        handlers.set(action, handler);
      },
    },
  });
  vi.stubGlobal("MediaMetadata", class {});
  player = await import("../player");
});
beforeEach(() => {
  player.clearPlayback();
  (player.audio as unknown as FakeAudio).playCalls = 0;
  useStore.setState({
    loaded: false,
    tracks: {},
    artists: {},
    albums: {},
    queue: [],
    currentId: null,
    history: [],
    past: [],
    future: [],
  });
});
afterEach(() => vi.restoreAllMocks());
describe("player interaction contracts", () => {
  it("pause and resume while a new asset loads never replays the previous audio", async () => {
    let resolve!: (v: AudioAsset) => void;
    vi.spyOn(db.assets, "get").mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }) as ReturnType<typeof db.assets.get>,
    );
    useStore.getState().play([track]);
    player.audio.src = "blob:previous";
    const pending = player.startCurrent();
    await player.togglePlayback();
    expect(player.usePlayback.getState().status).toBe("paused");
    await player.togglePlayback();
    expect(player.usePlayback.getState().status).toBe("loading");
    expect((player.audio as unknown as FakeAudio).playCalls).toBe(0);
    expect(player.audio.src).toBe("");
    resolve(asset);
    await pending;
    expect((player.audio as unknown as FakeAudio).playCalls).toBe(1);
  });
  it("media play is idempotent and media pause cancels pending autoplay intent", async () => {
    const get = vi.spyOn(db.assets, "get").mockResolvedValue(asset);
    useStore.getState().play([track]);
    await player.startCurrent();
    handlers.get("play")!();
    expect((player.audio as unknown as FakeAudio).playCalls).toBe(1);
    expect(player.audio.paused).toBe(false);
    let resolve!: (v: AudioAsset) => void;
    get.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }) as ReturnType<typeof db.assets.get>,
    );
    const pending = player.startCurrent();
    handlers.get("pause")!();
    resolve(asset);
    await pending;
    expect(player.audio.paused).toBe(true);
    expect((player.audio as unknown as FakeAudio).playCalls).toBe(1);
  });
  it("disabling shuffle leaves the queue order stable", () => {
    useStore.getState().play([track, { ...track, id: "local:2" }]);
    useStore.getState().settingsUpdate({ shuffle: true });
    const before = useStore.getState().queue;
    player.shuffleQueue();
    expect(useStore.getState().queue).toEqual(before);
    expect(useStore.getState().settings.shuffle).toBe(false);
  });
});
