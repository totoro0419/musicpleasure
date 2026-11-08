import { test, expect } from "@playwright/test";
import path from "node:path";
test("playlist creation, reload, undo/redo and responsive overflow", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", {
      name: "新しいプレイリスト あなたの「好き」を集めよう",
    })
    .click();
  await page.getByLabel("プレイリスト名", { exact: true }).fill("テスト選曲");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "テスト選曲", exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(600);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "テスト選曲", exact: true }),
  ).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
  await page.getByRole("button", { name: "プレイリストのメニュー" }).click();
  await page.getByRole("button", { name: "削除", exact: true }).click();
  await page
    .getByRole("button", { name: "取り消し (Ctrl+Z)", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: /テスト選曲 プレイリスト/ }),
  ).toBeVisible();
});
test("real MP3 playback, pause, seek and IndexedDB restoration", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .locator('input[type=file][accept="audio/mpeg,.mp3"]')
    .setInputFiles(path.resolve("backend/tests/fixtures/tone.mp3"));
  await page.getByRole("button", { name: "すべての曲", exact: true }).click();
  await page.getByRole("button", { name: "toneを再生", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const a = document.querySelector("audio");
        return a?.paused;
      }),
    )
    .toBe(false);
  await page.getByRole("button", { name: "フルプレーヤーを開く" }).click();
  await page.getByRole("button", { name: "再生・停止", exact: true }).click();
  const slider = page.getByLabel("フルプレーヤーの再生位置", { exact: true });
  await slider.press("Home");
  for (let i = 0; i < 10; i++) await slider.press("ArrowRight");
  await expect
    .poll(() =>
      page.evaluate(() => document.querySelector("audio")?.currentTime),
    )
    .toBeGreaterThan(0.8);
  await page.getByRole("button", { name: "閉じる", exact: true }).click();
  await page.waitForTimeout(600);
  await page.reload();
  await page.getByRole("button", { name: "すべての曲", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "toneを再生", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "toneを再生", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => document.querySelector("audio")?.paused))
    .toBe(false);
});
test("offline parser remains responsive when backend search fails", async ({
  page,
}) => {
  await page.route("**/api/**", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ detail: "検証用の接続失敗" }),
    }),
  );
  await page.goto("/#ai");
  await page
    .getByLabel("曲一覧・YouTube URL", { exact: true })
    .fill("Artist A - Song A\nArtist B - Song B");
  await page.getByRole("button", { name: "解析して候補を探す" }).click();
  await expect(
    page.getByRole("heading", { name: /登録プレビュー/ }),
  ).toBeVisible();
  await expect(page.getByText("Song A", { exact: true })).toBeVisible();
  const nav =
    page.viewportSize()!.width < 761
      ? page.getByRole("navigation", { name: "モバイルナビゲーション" })
      : page.getByRole("navigation", { name: "メインナビゲーション" });
  await nav.getByRole("link", { name: "ホーム", exact: true }).click();
  await expect(page.getByRole("heading", { name: /音楽に/ })).toBeVisible();
});

test("bulk preview confirms chosen candidates in the pasted order", async ({
  page,
}) => {
  await page.route("**/api/search?**", (route) => {
    const query = new URL(route.request().url()).searchParams.get("q") || "";
    const suffix = query.includes("Song A") ? "A" : "B";
    const id = suffix === "A" ? "aaaaaaaaaaa" : "bbbbbbbbbbb";
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: [
          {
            id: "yt:" + id,
            title: "Song " + suffix,
            artist: "Artist " + suffix,
            duration: 100,
            thumbnail: "",
            sources: [
              {
                id: "youtube:" + id,
                provider: "youtube",
                videoId: id,
                url: "https://www.youtube.com/watch?v=" + id,
                kind: "unknown",
                official: false,
                evidence: "test fixture",
              },
            ],
          },
        ],
        nextPageToken: "",
        provider: "local-test-fixture",
      }),
    });
  });
  await page.goto("/#ai");
  await page
    .getByLabel("曲一覧・YouTube URL", { exact: true })
    .fill("Artist B - Song B\nArtist A - Song A");
  await page.getByRole("button", { name: "解析して候補を探す" }).click();
  await page
    .getByLabel("1行目の候補", { exact: true })
    .selectOption("yt:bbbbbbbbbbb");
  await page
    .getByLabel("2行目の候補", { exact: true })
    .selectOption("yt:aaaaaaaaaaa");
  await page.getByRole("button", { name: "2曲を確定" }).click();
  await expect(
    page.getByRole("heading", { name: "新しいプレイリスト", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".track-info strong")).toHaveText([
    "Song B",
    "Song A",
  ]);
  await page.reload();
  await expect(page.locator(".track-info strong")).toHaveText([
    "Song B",
    "Song A",
  ]);
});

test("a large restored library scrolls with a bounded rendered row count", async ({
  page,
}) => {
  await page.goto("/");
  const settings = page.viewportSize()!.width < 761 ? "設定" : "設定・接続";
  await page.getByRole("button", { name: settings, exact: true }).click();
  const tracks = Object.fromEntries(
    Array.from({ length: 1000 }, (_, i) => {
      const id = "local:" + i;
      return [
        id,
        {
          id,
          title: "Track " + i,
          artist: "Test artist",
          duration: 10,
          thumbnail: "",
          sources: [
            {
              id,
              provider: "local",
              url: "",
              kind: "local",
              evidence: "test fixture",
              official: false,
            },
          ],
        },
      ];
    }),
  );
  const backup = {
    schema: 1,
    tracks,
    artists: {},
    albums: {},
    playlists: [],
    favorites: [],
    queue: [],
    currentId: null,
    position: 0,
    history: [],
    settings: {
      apiUrl: "",
      token: "",
      volume: 0.8,
      repeat: "none",
      shuffle: false,
      language: "ja",
    },
  };
  await page
    .locator('input[type=file][accept=".json,application/json"]')
    .setInputFiles({
      name: "test-library.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(backup)),
    });
  await expect(page.getByRole("status")).toContainText(
    "バックアップを復元しました",
  );
  await page.getByRole("button", { name: "閉じる", exact: true }).click();
  const nav =
    page.viewportSize()!.width < 761
      ? page.getByRole("navigation", { name: "モバイルナビゲーション" })
      : page.getByRole("navigation", { name: "メインナビゲーション" });
  await nav.getByRole("link", { name: "ライブラリ", exact: true }).click();
  await page.getByRole("button", { name: "すべての曲", exact: true }).click();
  await expect(page.getByText("Track 0", { exact: true })).toBeVisible();
  expect(await page.locator(".track-row").count()).toBeLessThan(60);
  await page.locator(".virtual-list").hover();
  await page.mouse.wheel(0, 100000);
  await expect(page.getByText("Track 999", { exact: true })).toBeVisible();
});
