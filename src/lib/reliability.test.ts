import { describe, it, expect, vi, afterEach } from "vitest";
import { PlaybackError, Reliability, classify } from "./reliability";
import { InvidiousClient } from "./invidious";
afterEach(() => vi.restoreAllMocks());
const health = (url: string) => ({
  url,
  success: 0,
  failure: 0,
  latency: 100,
  cooldown: 0,
  lastError: "",
  audioSuccess: 0,
  lastChecked: 0,
});
describe("truthful playback reliability", () => {
  it("distinguishes source refusal, browser policy and ambiguous CORS/network errors", () => {
    expect(classify(Error("LOGIN_REQUIRED")).kind).toBe("upstream_rejected");
    expect(classify(new DOMException("gesture", "NotAllowedError")).kind).toBe(
      "autoplay_blocked",
    );
    expect(classify(new TypeError("Failed to fetch")).kind).toBe(
      "network_or_cors",
    );
  });
  it("retains the instance when a decoder reports a failure without one", () => {
    expect(
      classify(
        new PlaybackError("timeout", "slow", "probe"),
        "play",
        "https://invidious.test",
      ).instance,
    ).toBe("https://invidious.test");
  });
  it("temporarily excludes failed videos, expires and permits manual reset", () => {
    const r = new Reliability();
    r.block("bad", new PlaybackError("upstream_rejected", "blocked"));
    expect(r.isExcluded("bad")).toBe(true);
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 31 * 60000);
    expect(r.isExcluded("bad")).toBe(false);
    r.clear("bad");
    expect(r.excluded.bad).toBeUndefined();
  });
  it("never permanently dislikes a track or excludes it for autoplay/global API failure", () => {
    const r = new Reliability();
    for (const kind of [
      "autoplay_blocked",
      "api_unavailable",
      "cancelled",
      "internal",
    ] as const)
      r.block(kind, new PlaybackError(kind, "test"));
    expect(Object.keys(r.excluded)).toHaveLength(0);
  });
  it("does not let search successes erase audio failures or count preparation as playback", () => {
    const p = new InvidiousClient();
    p.health = [health("https://api.test")];
    vi.spyOn(p, "record").mockImplementation(() => {});
    p.audioResult(
      p.health[0].url,
      "failure",
      new PlaybackError("upstream_rejected", "refused"),
    );
    p.audioResult(p.health[0].url, "prepared");
    expect(p.health[0].audioSuccess).toBe(0);
    expect(p.health[0].audioFailure).toBe(1);
    expect(p.health[0].audioPrepared).toBe(1);
  });
  it("ranks real playback success above a faster search-only endpoint", () => {
    const p = new InvidiousClient();
    p.health = [
      {
        ...health("https://search.test"),
        latency: 1,
        success: 9999,
        audioFailure: 15,
      },
      { ...health("https://audio.test"), latency: 400, audioSuccess: 8 },
    ];
    expect(p.ranked(false, "audio")[0].url).toBe("https://audio.test");
  });
  it("bounded diagnostics redact signed media URLs", () => {
    const r = new Reliability();
    for (let i = 0; i < 260; i++)
      r.record({
        instance: "https://api.test",
        stage: "probe",
        outcome: "failure",
        detail: "failure https://audio.test/a?token=secret",
      });
    expect(r.events).toHaveLength(240);
    expect(r.events[0].detail).not.toContain("secret");
  });
});
