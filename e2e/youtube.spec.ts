import { test, expect } from "@playwright/test";

// Deterministic transport contract, NOT evidence of live YouTube playback.
const iframeApiFixture = `
window.YT = {Player: class {
  constructor(frame, {events}) {
    this.events = events; this.time = Number(new URL(frame.src).searchParams.get('start')) || 0;
    this.playing = false; frame.dataset.instance = String(performance.now());
    this.error = frame.src.includes('bbbbbbbbbbb');
    this.silent = frame.src.includes('ccccccccccc');
    this.timer = setInterval(() => { if(this.playing) this.time += .2; }, 200);
    setTimeout(() => events.onReady({target:this}), 0);
  }
  playVideo() { if(this.silent) return; if(this.error) { this.events.onError({data:150}); return; } this.playing=true; this.events.onStateChange({data:1}); }
  pauseVideo() { this.playing=false; this.events.onStateChange({data:2}); }
  seekTo(time) { this.time=time; }
  setVolume(v) { this.volume=v; }
  getCurrentTime() { return this.time; }
  getDuration() { return 100; }
  destroy() { clearInterval(this.timer); }
}};
window.onYouTubeIframeAPIReady();`;
function fixtureTrack(id: string, title: string) {
  return {
    id: "yt:" + id,
    title,
    artist: "Transport test fixture",
    duration: 100,
    thumbnail: "",
    sources: [
      {
        id: "youtube:" + id,
        provider: "youtube",
        videoId: id,
        url: "https://www.youtube.com/watch?v=" + id,
        kind: "unknown",
        evidence: "test fixture",
        official: false,
      },
    ],
  };
}
test.beforeEach(async ({ page }) => {
  await page.route("https://www.youtube.com/iframe_api", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: iframeApiFixture,
    }),
  );
  await page.route("https://www.youtube.com/embed/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Transport test fixture</title>",
    }),
  );
  await page.route("**/api/search?**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        items: [
          fixtureTrack("M7lc1UVf-VE", "Stream fixture"),
          fixtureTrack("bbbbbbbbbbb", "Blocked fixture"),
          fixtureTrack("ccccccccccc", "Silent fixture"),
        ],
        nextPageToken: "",
        provider: "transport-test-fixture",
      }),
    }),
  );
});
test("streaming transport controls, navigation, stable iframe, layout and resume", async ({
  page,
}) => {
  const jobs: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/jobs")) jobs.push(r.url());
  });
  await page.goto("/#search");
  await page
    .getByLabel("曲・アーティスト・YouTube URLを検索", { exact: true })
    .fill("transport fixture");
  await page
    .getByRole("button", { name: "Stream fixtureを再生", exact: true })
    .click();
  const frame = page.locator(".youtube-frame iframe");
  await expect(frame).toBeVisible();
  const instance = await frame.getAttribute("data-instance");
  const small = page.viewportSize()!.width < 761;
  const playButton = small
    ? page.locator(".mobile-play button").first()
    : page.locator(".transport .play-button");
  await expect(playButton).toHaveAttribute("aria-label", "一時停止");
  const box = await frame.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(200);
  expect(box!.height).toBeGreaterThanOrEqual(200);
  await playButton.click();
  await expect(playButton).toHaveAttribute("aria-label", "再生");
  // Seek through the shared control even though HTMLAudioElement has no src.
  if (small) {
    await page
      .getByRole("button", { name: "YouTubeプレーヤーを拡大", exact: true })
      .click();
    const seek = page.getByLabel("YouTubeの再生位置", { exact: true });
    await seek.press("Home");
    await seek.press("ArrowRight");
    await expect(seek).toHaveValue("0.1");
  } else {
    const seek = page.getByLabel("再生位置", { exact: true });
    await seek.press("Home");
    await seek.press("ArrowRight");
    await expect(seek).toHaveValue("0.1");
  }
  await page
    .getByRole("button", {
      name: small ? "YouTubeプレーヤーを縮小" : "YouTubeプレーヤーを拡大",
      exact: true,
    })
    .click();
  expect(await frame.getAttribute("data-instance")).toBe(instance);
  if (!small)
    await page
      .getByRole("button", { name: "YouTubeプレーヤーを縮小", exact: true })
      .click();
  const nav = page.getByRole("navigation", {
    name: small ? "モバイルナビゲーション" : "メインナビゲーション",
  });
  await nav.getByRole("link", { name: "ライブラリ", exact: true }).click();
  expect(await frame.getAttribute("data-instance")).toBe(instance);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await playButton.click();
  await expect(playButton).toHaveAttribute("aria-label", "一時停止");
  await page.waitForTimeout(2600); // Exercise time-based autosave, not just initial state.
  await playButton.click();
  await page.waitForTimeout(600);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "フルプレーヤーを開く" }),
  ).toContainText("Stream fixture");
  await expect(page.locator(".youtube-frame iframe")).toHaveCount(0); // Restore without surprise autoplay.
  await playButton.click();
  await expect(frame).toBeVisible();
  expect(
    Number(
      new URL((await frame.getAttribute("src"))!).searchParams.get("start"),
    ),
  ).toBeGreaterThan(0);
  expect(jobs).toEqual([]);
});
test("embedding failure exposes recovery and does not block search or navigation", async ({
  page,
}) => {
  await page.goto("/#search");
  await page
    .getByLabel("曲・アーティスト・YouTube URLを検索", { exact: true })
    .fill("transport fixture");
  await page
    .getByRole("button", { name: "Blocked fixtureを再生", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "埋め込み再生が許可されていません",
  );
  await expect(
    page.getByRole("link", { name: "YouTubeで開く", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "スキップ", exact: true }).click();
  await page
    .getByRole("button", { name: "YouTube再生を終了", exact: true })
    .click();
  await expect(page.locator(".youtube-frame iframe")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Stream fixtureを再生", exact: true })
    .last()
    .click();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("an iframe that becomes ready but never plays times out with recovery", async ({
  page,
}) => {
  await page.clock.install();
  await page.goto("/#search");
  await page
    .getByLabel("曲・アーティスト・YouTube URLを検索", { exact: true })
    .fill("silent fixture");
  await page.clock.runFor(500);
  await page
    .getByRole("button", { name: "Silent fixtureを再生", exact: true })
    .click();
  await expect(page.locator(".youtube-frame iframe")).toBeVisible();
  await page.clock.runFor(32000);
  await expect(page.getByRole("alert")).toContainText(
    "再生が始まりませんでした",
  );
  await expect(
    page.getByRole("button", { name: "再試行", exact: true }),
  ).toBeVisible();
  const small = page.viewportSize()!.width < 761;
  const nav = page.getByRole("navigation", {
    name: small ? "モバイルナビゲーション" : "メインナビゲーション",
  });
  await nav.getByRole("link", { name: "ホーム", exact: true }).click();
  await expect(page.getByRole("heading", { name: /音楽に/ })).toBeVisible();
});
