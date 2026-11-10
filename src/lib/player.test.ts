import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { emptyData, placeholder } from "./model";
class FakeAudio extends EventTarget {
  preload = "";
  volume = 1;
  src = "";
  duration = 100;
  currentTime = 0;
  paused = true;
  canPlayType() {
    return "probably";
  }
  play() {
    if (this.src.includes("broken")) return Promise.reject(Error("403"));
    this.paused = false;
    this.dispatchEvent(new Event("playing"));
    this.currentTime += 0.1;
    this.dispatchEvent(new Event("timeupdate"));
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
  readyState=0;
  load() {this.readyState=this.src?2:0;if(this.src)this.dispatchEvent(new Event("loadeddata"));}
  removeAttribute(name: string) {
    if (name === "src") this.src = "";
  }
}
const info = (name: string, urls = ["https://audio.test/valid"]) => ({
  title: name,
  uploader: "Artist",
  uploaderUrl: "/channel/test",
  thumbnailUrl: "",
  duration: 100,
  relatedStreams: [],
  audioStreams: urls.map((url) => ({
    url,
    mimeType: "audio/mp4",
    bitrate: 128000,
  })),
});
beforeEach(() => {
  vi.useFakeTimers();
  vi.resetModules();
  vi.stubGlobal("Audio", FakeAudio);
  vi.stubGlobal("window", {});
  vi.stubGlobal("document", new EventTarget());
  vi.stubGlobal("navigator", {});
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function setup() {
  const { invidious } = await import("./invidious");
  invidious.health = [
    {
      url: "https://api.test",
      success: 0,
      failure: 0,
      latency: 0,
      cooldown: 0,
      lastError: "",
      audioSuccess: 0,
      lastChecked: 0,
    },
  ];
  vi.spyOn(invidious, "record").mockImplementation(() => {});
  const { MusicPlayer } = await import("./player");
  return { invidious, p: new MusicPlayer() };
}
describe("playback concurrency and recovery (simulated media)", () => {
  it("starts only a playable stream and reports audio success", async () => {
    const { p, invidious } = await setup();
    vi.spyOn(invidious, "at").mockResolvedValue(info("First"));
    await p.load(placeholder("M7lc1UVf-VE"), {
      ...emptyData().settings,
      engine: "invidious",
    });
    expect(p.state.status).toBe("playing");
    expect(p.audio.paused).toBe(false);
    p.audio.currentTime = 2;
    await vi.advanceTimersByTimeAsync(500);
    expect(invidious.health[0].audioSuccess).toBe(1);
  });
  it("tries another compatible format after audio URL failure", async () => {
    const { p, invidious } = await setup();
    vi.spyOn(invidious, "at").mockResolvedValue(
      info("First", ["https://audio.test/broken", "https://audio.test/valid"]),
    );
    await p.load(placeholder("M7lc1UVf-VE"), {
      ...emptyData().settings,
      engine: "invidious",
    });
    expect(p.state.status).toBe("playing");
    expect(p.audio.src).toContain("valid");
  });
  it("never treats JSON success without audio as successful playback", async () => {
    const { p, invidious } = await setup();
    vi.spyOn(invidious, "at").mockResolvedValue(info("First", []));
    await p.load(placeholder("M7lc1UVf-VE"), {
      ...emptyData().settings,
      engine: "invidious",
    });
    expect(p.state.status).toBe("error");
    expect(invidious.health[0].audioSuccess).toBe(0);
  });
  it("ignores a late response after stop", async () => {
    const { p, invidious } = await setup();
    let resolve!: (v: unknown) => void;
    vi.spyOn(invidious, "at").mockImplementation(
      () => new Promise((r) => (resolve = r)),
    );
    const load = p.load(placeholder("M7lc1UVf-VE"), emptyData().settings);
    p.stop();
    resolve(info("Stale"));
    await load;
    expect(p.state.status).toBe("idle");
    expect(p.audio.paused).toBe(true);
    expect(p.audio.src).toBe("");
  });
  it("ignores the old track response during rapid next-track requests", async () => {
    const { p, invidious } = await setup();
    let first!: (v: unknown) => void;
    let count = 0;
    vi.spyOn(invidious, "at").mockImplementation(() =>
      ++count === 1
        ? new Promise((r) => (first = r))
        : (Promise.resolve(info("New")) as never),
    );
    const firstLoad = p.load(placeholder("M7lc1UVf-VE"), emptyData().settings);
    await p.load(placeholder("aqz-KE-bpKQ"), emptyData().settings);
    first(info("Old"));
    await firstLoad;
    expect(p.state.trackId).toBe("aqz-KE-bpKQ");
    expect(p.state.status).toBe("playing");
  });
  it("consumes duplicate ended events only once", async () => {
    const { p, invidious } = await setup();
    vi.spyOn(invidious, "at").mockResolvedValue(info("First"));
    const ended = vi.fn();
    p.onEnded = ended;
    await p.load(placeholder("M7lc1UVf-VE"), emptyData().settings);
    p.audio.dispatchEvent(new Event("ended"));
    p.audio.dispatchEvent(new Event("ended"));
    expect(ended).toHaveBeenCalledTimes(1);
  });
  it("pause, resume and seek stay within the current engine", async () => {
    const { p, invidious } = await setup();
    vi.spyOn(invidious, "at").mockResolvedValue(info("First"));
    await p.load(placeholder("M7lc1UVf-VE"), emptyData().settings);
    p.seek(35);
    expect(p.audio.currentTime).toBe(35);
    p.pause();
    expect(p.audio.paused).toBe(true);
    expect(p.state.status).toBe("paused");
    await p.play();
    expect(p.audio.paused).toBe(false);
    expect(p.state.status).toBe("playing");
  });
  it("respects data saver for optional prefetch without disabling required radio checks", async () => {
    const { p } = await setup();
    vi.stubGlobal("navigator", { connection: { saveData: true } });
    const prepare = vi.spyOn(p.resolver, "prepare").mockResolvedValue({
      id: "M7lc1UVf-VE", instance: "https://api.test", info: info("Radio"),
      stream: info("Radio").audioStreams[0], at: Date.now(), checked: "decoded",
    });
    await p.prefetch("M7lc1UVf-VE", emptyData().settings);
    expect(prepare).not.toHaveBeenCalled();
    expect(await p.prefetch("M7lc1UVf-VE", emptyData().settings, undefined, true))
      .toMatchObject({ checked: "decoded" });
    expect(prepare).toHaveBeenCalledTimes(1);
  });
});
it("does not report a decoded but stalled source as a successful load", async () => {
 class StalledAudio extends FakeAudio {
  play() { this.paused=false; this.dispatchEvent(new Event("playing")); return Promise.resolve(); }
 }
 vi.stubGlobal("Audio", StalledAudio);
 const {p,invidious}=await setup();
 vi.spyOn(invidious,"at").mockResolvedValue(info("Stalled"));
 const loading=p.load(placeholder("M7lc1UVf-VE"),emptyData().settings);
 await vi.advanceTimersByTimeAsync(13000);
 expect((await loading).status).toBe("failed");
 expect(invidious.health[0].audioSuccess).toBe(0);
});
