import { describe, it, expect, vi, afterEach } from "vitest";
import { PipedClient, compatibleStreams } from "./piped";
const health = (url: string) => ({
  url,
  success: 0,
  failure: 0,
  latency: 0,
  cooldown: 0,
  lastError: "",
  audioSuccess: 0,
  lastChecked: 0,
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("Piped endpoint recovery", () => {
  it("reaches a working instance after the first six fail", async () => {
    const c = new PipedClient();
    c.health = Array.from({ length: 8 }, (_, i) =>
      health(`https://piped${i}.test`),
    );
    vi.spyOn(c, "record").mockImplementation(() => {});
    const fetchMock = vi.fn(
      async (input: string) =>
        new Response(
          JSON.stringify(
            input.includes("piped7.")
              ? { items: [], nextpage: null }
              : { error: "down" },
          ),
          { status: input.includes("piped7.") ? 200 : 503 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await c.search("music");
    expect(result.items).toEqual([]);
    expect(c.health[7].success).toBe(1);
    expect(c.health[0].failure).toBe(1);
  });
  it("rechecks cooling instances if all ordinary candidates fail", async () => {
    const c = new PipedClient();
    c.health = [
      health("https://bad.test"),
      { ...health("https://good.test"), cooldown: Date.now() + 100000 },
    ];
    vi.spyOn(c, "record").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (input: string) =>
          new Response(
            JSON.stringify(
              input.includes("good") ? { items: [] } : { error: "down" },
            ),
            { status: input.includes("good") ? 200 : 503 },
          ),
      ),
    );
    expect((await c.search("music")).items).toEqual([]);
  });
  it("distinguishes upstream video rejection from a generic HTTP error", async () => {
    const c = new PipedClient();
    c.health = [health("https://blocked.test")];
    vi.spyOn(c, "record").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: "SignInConfirmNotBotException LOGIN_REQUIRED",
            }),
            { status: 500 },
          ),
      ),
    );
    await expect(c.at(c.health[0].url, "/streams/id")).rejects.toThrow(
      "配信元",
    );
    expect(c.health[0].audioSuccess).toBe(0);
  });
  it("aborted requests do not run more retries", async () => {
    const c = new PipedClient();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const abort = new AbortController();
    abort.abort();
    await expect(c.search("music", undefined, abort.signal)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("Piped-provided muxed MP4 is explicit and preferred over secondary mirrors", () => {
    const streams = [
      {
        url: "https://secondary/1",
        mimeType: "video/mp4",
        bitrate: 0,
        quality: "LBRY",
      },
      {
        url: "https://pipedproxy/2",
        mimeType: "video/mp4",
        bitrate: 0,
        quality: "360p",
      },
    ];
    expect(compatibleStreams(streams, () => "probably")).toHaveLength(0);
    expect(
      compatibleStreams(streams, () => "probably", "balanced", true)[0].url,
    ).toContain("pipedproxy");
  });
});
