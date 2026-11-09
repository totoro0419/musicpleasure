import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StreamResolver } from "./streams";
import { piped } from "./piped";
import { PlaybackError } from "./reliability";
import { emptyData } from "./model";
const info = (urls = ["https://audio.test/a"]) => ({
  title: "Track",
  uploader: "Artist",
  uploaderUrl: "",
  duration: 60,
  thumbnailUrl: "",
  relatedStreams: [],
  audioStreams: urls.map((url) => ({
    url,
    mimeType: "audio/mp4",
    bitrate: 128000,
  })),
});
beforeEach(() => {
  piped.health = ["https://one.test", "https://two.test"].map((url) => ({
    url,
    success: 0,
    failure: 0,
    latency: 0,
    cooldown: 0,
    lastError: "",
    audioSuccess: 0,
    lastChecked: 0,
  }));
  vi.spyOn(piped, "record").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("decoded-audio preparation", () => {
  it("silently probes and caches a playable stream without claiming real playback", async () => {
    vi.spyOn(piped, "at").mockResolvedValue(info());
    const probe = vi.fn(async () => {}),
      r = new StreamResolver(() => "probably", probe);
    const first = await r.prepare("id", emptyData().settings);
    await r.prepare("id", emptyData().settings);
    expect(first.checked).toBe("decoded");
    expect(probe).toHaveBeenCalledTimes(1);
    expect(piped.health[0].audioSuccess).toBe(0);
    expect(piped.health[0].audioPrepared).toBe(1);
  });
  it("does not wait for a slow sibling once another instance yields decoded audio", async () => {
    vi.spyOn(piped, "at").mockImplementation((url) =>
      url.includes("one") ? Promise.resolve(info()) : new Promise(() => {}),
    );
    const r = new StreamResolver(
      () => "probably",
      async () => {},
    );
    expect((await r.prepare("id", emptyData().settings)).instance).toContain(
      "one",
    );
  });
  it("recovers across Piped instances after a source refusal", async () => {
    vi.spyOn(piped, "at").mockImplementation((url) =>
      url.includes("one")
        ? Promise.reject(
            new PlaybackError("upstream_rejected", "blocked", "streams", url),
          )
        : Promise.resolve(info()),
    );
    const r = new StreamResolver(
      () => "probably",
      async () => {},
    );
    expect((await r.prepare("id", emptyData().settings)).instance).toContain(
      "two",
    );
    expect(piped.health[0].audioFailure).toBe(1);
  });
  it("tries another codec/URL after a failed probe and records a readable media 403", async () => {
    vi.spyOn(piped, "at").mockResolvedValue(
      info(["https://audio.test/broken", "https://audio.test/ok"]),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 403 })),
    );
    const r = new StreamResolver(
      () => "probably",
      async (s) => {
        if (s.url.includes("broken"))
          throw new PlaybackError("network_or_cors", "opaque", "probe");
      },
    );
    expect((await r.prepare("id", emptyData().settings)).stream.url).toContain(
      "/ok",
    );
    expect(piped.health[0].lastAudioError).toContain("403");
  });
  it("does not use expired signed URLs from the prepared cache", async () => {
    const at = vi
      .spyOn(piped, "at")
      .mockResolvedValue(
        info([
          `https://audio.test/a?expire=${Math.floor(Date.now() / 1000) + 10}`,
        ]),
      );
    const r = new StreamResolver(
      () => "probably",
      async () => {},
    );
    await r.prepare("id", emptyData().settings);
    await r.prepare("id", emptyData().settings);
    expect(at.mock.calls.length).toBe(4);
  });
  it("treats unsupported codecs as different from a Piped-wide outage", async () => {
    vi.spyOn(piped, "at").mockResolvedValue(info());
    const r = new StreamResolver(
      () => "",
      async () => {},
    );
    await expect(r.prepare("id", emptyData().settings)).rejects.toMatchObject({
      kind: "unsupported_format",
    });
  });
  it("never returns a successful preparation from a JSON-only response", async () => {
    vi.spyOn(piped, "at").mockResolvedValue(info([]));
    const r = new StreamResolver(
      () => "probably",
      async () => {},
    );
    await expect(r.prepare("id", emptyData().settings)).rejects.toMatchObject({
      kind: "no_stream",
    });
  });
  it("aborted consumers cannot turn a late preparation into playback", async () => {
    let finish!: (v: unknown) => void;
    vi.spyOn(piped, "at").mockImplementation(
      () => new Promise((r) => (finish = r)),
    );
    const control = new AbortController(),
      r = new StreamResolver(
        () => "probably",
        async () => {},
      );
    const job = r.prepare("id", emptyData().settings, control.signal);
    control.abort();
    await expect(job).rejects.toThrow();
    finish(info());
  });
});
