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
    settings: {...useStore.getState().settings, repeat: "none", shuffle: false},
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

const ytTrack: Track = {
  ...track, id: "yt:M7lc1UVf-VE", title: "YouTube fixture",
  sources: [{id: "youtube:M7lc1UVf-VE", provider: "youtube", videoId: "M7lc1UVf-VE", url: "https://www.youtube.com/watch?v=M7lc1UVf-VE", kind: "unknown", evidence: "test fixture", official: false}],
};
function controller() {
  return {playVideo: vi.fn(), pauseVideo: vi.fn(), seekTo: vi.fn(), setVolume: vi.fn(), getCurrentTime: () => 12, getDuration: () => 100, destroy: vi.fn()};
}
describe("Curiveo-style playback", () => {
  it("streams an uncached YouTube track without a download job; records only real PLAYING events", async () => {
    vi.spyOn(db.assets, "get").mockResolvedValue(undefined);
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await player.playTracks([ytTrack]);
    const run = player.usePlayback.getState().requestId;
    expect(player.usePlayback.getState()).toMatchObject({engine: "youtube", videoId: "M7lc1UVf-VE", status: "loading"});
    const yt = controller();
    player.connectYouTube(run, yt);
    expect(yt.playVideo).toHaveBeenCalledTimes(1);
    expect(player.usePlayback.getState().status).toBe("loading");
    expect(useStore.getState().history).toHaveLength(0);
    player.youtubeState(run, 1); player.youtubeState(run, 1);
    expect(useStore.getState().history).toHaveLength(1);
    expect(fetch).not.toHaveBeenCalled();
    player.youtubeState(run, 2);
    expect(useStore.getState().position).toBe(12);
    await player.togglePlayback();
    expect(yt.playVideo).toHaveBeenCalledTimes(2);
    player.seek(200);
    expect(yt.seekTo).toHaveBeenCalledWith(100, true);
    useStore.getState().settingsUpdate({volume: .35});
    expect(yt.setVolume).toHaveBeenLastCalledWith(35);
  });
  it("a pause during IFrame startup cancels automatic play; blocked autoplay is truthful and recoverable", async () => {
    vi.spyOn(db.assets, "get").mockResolvedValue(undefined);
    await player.playTracks([ytTrack]);
    await player.togglePlayback();
    const yt = controller(), run = player.usePlayback.getState().requestId;
    player.connectYouTube(run, yt);
    expect(yt.playVideo).not.toHaveBeenCalled();
    player.youtubeBlocked(run);
    expect(player.usePlayback.getState()).toMatchObject({status: "paused"});
    expect(useStore.getState().history).toHaveLength(0);
    // A click inside the official frame is reported by its PLAYING event.
    player.youtubeState(run, 1);
    expect(player.usePlayback.getState().status).toBe("playing");
    expect(player.usePlayback.getState().notice).toBe("");
  });
  it("ignores stale events after switching tracks and after errors", async () => {
    vi.spyOn(db.assets, "get").mockResolvedValue(undefined);
    await player.playTracks([ytTrack, {...ytTrack, id: "yt:second"}]);
    const oldRun = player.usePlayback.getState().requestId;
    await player.next();
    const current = useStore.getState().currentId, run = player.usePlayback.getState().requestId;
    player.youtubeState(oldRun, 0); player.youtubeState(oldRun, 1);
    player.youtubeFailure(oldRun, "old error");
    expect(useStore.getState().currentId).toBe(current);
    expect(useStore.getState().history).toHaveLength(0);
    player.youtubeFailure(run, "Embedding disabled");
    player.youtubeState(run, 2);
    expect(player.usePlayback.getState()).toMatchObject({status: "error", error: "Embedding disabled"});
    await player.togglePlayback();
    expect(player.usePlayback.getState().status).toBe("loading");
    expect(player.usePlayback.getState().requestId).not.toBe(run);
  });
  it("prefers a saved MP3 even for a YouTube source", async () => {
    vi.spyOn(db.assets, "get").mockResolvedValue({...asset, id: ytTrack.sources[0].id});
    await player.playTracks([ytTrack]);
    expect(player.usePlayback.getState().engine).toBe("audio");
    expect(player.audio.src).toMatch(/^blob:/);
  });
  it("repeats one streaming track and advances to a local MP3 without editing the playlist", async () => {
    vi.spyOn(db.assets, "get").mockImplementation((id) => Promise.resolve((id as unknown) === "local:test" ? asset : undefined) as ReturnType<typeof db.assets.get>);
    const id = useStore.getState().createPlaylist("Mixed", [ytTrack, track]);
    const entries = useStore.getState().playlists.find(p => p.id === id)!.entries;
    await player.playTracks([ytTrack, track]);
    const yt = controller(), run = player.usePlayback.getState().requestId;
    player.connectYouTube(run, yt);
    useStore.getState().settingsUpdate({repeat: "one"});
    await player.next(true);
    expect(yt.seekTo).toHaveBeenCalledWith(0, true);
    expect(yt.playVideo).toHaveBeenCalledTimes(2);
    useStore.getState().settingsUpdate({repeat: "none"});
    await player.next(true);
    expect(player.usePlayback.getState().engine).toBe("audio");
    expect(useStore.getState().playlists.find(p => p.id === id)!.entries).toEqual(entries);
  });
});
