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
