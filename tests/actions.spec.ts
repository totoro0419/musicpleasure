import { expect, test, type Locator, type Page } from "@playwright/test";
import { tone } from "./audio-fixtures";
import { emptyData, placeholder } from "../src/lib/model";

const ids = ["M7lc1UVf-VE", "aqz-KE-bpKQ", "dQw4w9WgXcQ", "djV11Xbc914", "fJ9rUzIMcZQ"];
const titles = ["Aurora Song", "Aurora Song (Acoustic Version)", "Blue Sky", "Aurora Song (Live)", "Evening Star"];
const videos = ids.map((videoId, index) => ({
  type: "video", videoId, title: titles[index], lengthSeconds: 8,
  author: index < 2 ? "Singer" : "Other", authorUrl: index < 2 ? "/channel/UCSinger" : "/channel/UCOther",
}));
const cors = { "access-control-allow-origin": "*" };
async function tap(control: Locator, touch: boolean) {
  if (touch) await control.tap();
  else await control.click();
}
async function mockMusic(page: Page, denied: number[] = []) {
  await page.route("https://**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "media.musicpleasure.test") {
      const index = ids.indexOf(url.pathname.split("/").at(-1) || "");
      return route.fulfill({ headers: cors, contentType: "audio/wav", body: tone(index, 8).buffer });
    }
    if (url.pathname.startsWith("/api/v1/videos/")) {
      const index = ids.indexOf(url.pathname.split("/").at(-1) || "");
      if (index < 0 || denied.includes(index)) {
        return route.fulfill({ headers: cors, status: 500, json: { error: "LOGIN_REQUIRED" } });
      }
      return route.fulfill({ headers: cors, json: {
        ...videos[index], recommendedVideos: videos.filter((_, i) => i !== index),
        adaptiveFormats: [{ url: "https://media.musicpleasure.test/" + ids[index], type: "audio/wav" }],
      } });
    }
    if (url.pathname === "/api/v1/search/suggestions")
      return route.fulfill({ headers: cors, json: { suggestions: ["Aurora Song"] } });
    if (url.pathname === "/api/v1/search") {
      const term = url.searchParams.get("q");
      const pageNumber = url.searchParams.get("page");
      const channel = url.searchParams.get("type") === "channel";
      const json = channel
        ? Array.from({ length: pageNumber === "2" ? 1 : 20 }, (_, i) => ({
            type: "channel", authorId: "UCSinger" + (pageNumber === "2" ? 20 : i),
            author: "Singer " + (pageNumber === "2" ? 20 : i),
          }))
        : term === "starter" || term === "Aurora Song" ? [videos[0]] : videos;
      return route.fulfill({ headers: cors, json });
    }
    if (url.pathname.startsWith("/api/v1/channels/"))
      return route.fulfill({ headers: cors, json: { videos: videos.slice(0, 2) } });
    if (url.hostname === "i.ytimg.com") return route.fulfill({ status: 404, body: "" });
    return route.continue();
  });
}
async function progresses(page: Page, expectedId?: string) {
  const mini = page.locator(".mini-track");
  if (expectedId) await expect(mini).toHaveAttribute("data-track-id", expectedId, { timeout: 14000 });
  await expect(mini).toContainText("再生中");
  const seek = page.getByLabel("再生位置", { exact: true });
  let previous = Number(await seek.inputValue());
  await expect.poll(async () => {
    if (expectedId && await mini.getAttribute("data-track-id") !== expectedId) return false;
    const position = Number(await seek.inputValue());
    const delta = position - previous;
    previous = position;
    return delta > 0 && delta <= 2;
  }, { timeout: 6000, intervals: [200, 350, 500] }).toBe(true);
}
test("first-run radio searches in place and plays three different tracks across ended events", async ({ page, hasTouch }) => {
  await mockMusic(page, [1]);
  await page.goto("./#radio");
  const query = page.getByRole("searchbox", { name: "ラジオの基準曲を検索" });
  await query.fill("starter");
  await query.press("Enter");
  await tap(page.getByRole("button", { name: "Aurora Song · Singerから開始", exact: true }), hasTouch);
  await progresses(page, ids[0]);
  await expect(page.locator("main .trackrow")).toHaveCount(3);
  const second = await page.locator("main .trackrow .title").first().textContent();
  const third = await page.locator("main .trackrow .title").nth(1).textContent();
  expect(second).not.toBe(titles[1]);
  expect(third).not.toBe(titles[1]);
  await progresses(page, ids[titles.indexOf(second!)]);
  await page.goto("#library");
  await progresses(page, ids[titles.indexOf(third!)]);
  expect(new Set([titles[0], second, third]).size).toBe(3);
});

test("search and favorites can start radio, stop it while sound continues, and change its direction", async ({ page, hasTouch }) => {
  await mockMusic(page);
  await page.goto("./#search");
  await page.getByLabel("楽曲を検索").fill("starter");
  await page.getByLabel("楽曲を検索").press("Enter");
  await tap(page.getByRole("button", { name: "Aurora Songをお気に入り登録", exact: true }), hasTouch);
  const menu = page.getByLabel("Aurora Songのその他の操作");
  await tap(menu, hasTouch);
  await tap(page.getByRole("button", { name: "この歌い手の曲を続けて聴く", exact: true }), hasTouch);
  await progresses(page, ids[0]);
  await page.goto("#radio");
  await expect(page.getByText("現在の方向 · 同じ歌い手")).toBeVisible();
  await expect(page.locator("main .trackrow")).toHaveCount(1);
  await expect(page.locator("main .trackrow")).toContainText(titles[1]);
  await tap(page.getByRole("button", { name: "新しい曲を多めに", exact: true }), hasTouch);
  await expect(page.getByRole("button", { name: "新しい曲を多めに" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("main .trackrow")).toHaveCount(3);
  await tap(page.getByRole("button", { name: "おすすめの自動追加を停止", exact: true }), hasTouch);
  await expect(page.getByRole("button", { name: "おすすめの自動追加を停止" })).toHaveCount(0);
  await progresses(page, ids[0]);
  await page.getByLabel("保存した曲から選ぶ").selectOption(ids[0]);
  await tap(page.getByRole("button", { name: "ラジオを開始", exact: true }), hasTouch);
  await expect(page.getByRole("button", { name: "おすすめの自動追加を停止" })).toBeVisible();
  await page.locator("main .trackrow").first().locator("summary").click();
  await tap(page.getByRole("button", { name: "この曲の別バージョンを探す", exact: true }), hasTouch);
  await expect(page.getByText("現在の方向 · 同じ曲の別バージョン")).toBeVisible();
});

test("a refused radio seed advances to a playable recommendation", async ({ page }) => {
  await mockMusic(page, [0]);
  await page.goto("./#radio");
  await page.getByLabel("ラジオの基準曲を検索").fill("starter");
  await page.getByRole("button", { name: "検索", exact: true }).click();
  await page.getByRole("button", { name: "Aurora Song · Singerから開始", exact: true }).click();
  await expect(page.locator(".mini-track")).not.toHaveAttribute("data-track-id", ids[0], { timeout: 15000 });
  await progresses(page);
  await expect(page.locator(".mini-track")).not.toHaveAttribute("data-track-id", ids[0]);
});

test("channel pagination retains earlier results and playlist URLs are handed to import", async ({ page }) => {
  await mockMusic(page);
  await page.goto("./#search");
  const search = page.getByLabel("楽曲を検索");
  await search.fill("Singer");
  await page.getByRole("button", { name: "チャンネル", exact: true }).click();
  await expect(page.getByText("Singer 0", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "さらに読み込む" }).click();
  await expect(page.getByText("Singer 20", { exact: true })).toBeVisible();
  await expect(page.getByText("Singer 0", { exact: true })).toBeVisible();
  const first = page.locator("main .panel").filter({ hasText: /^Singer 0/ }).first();
  await first.getByRole("button", { name: "歌い手を保存" }).click();
  await expect(first.getByRole("button", { name: "歌い手の保存を解除" })).toHaveAttribute("aria-pressed", "true");
  await first.getByRole("button", { name: "投稿曲を表示" }).click();
  await expect(page.locator("main .trackrow")).toHaveCount(2);
  const url = "https://www.youtube.com/playlist?list=PLActionTest";
  await search.fill(url);
  await search.press("Enter");
  await expect(page.getByLabel("プレイリストURL", { exact: true })).toHaveValue(url);
});

test("queue order, volume and settings survive reload and the exported backup contains the changes", async ({ page }) => {
  await mockMusic(page);
  const data = emptyData();
  data.tracks = Object.fromEntries(ids.slice(0, 3).map((id) => [id, placeholder(id)]));
  data.queue = ids.slice(0, 3);
  data.current = 0;
  await page.goto("./#settings");
  await page.locator("input[type=file]").setInputFiles({
    name: "queue.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(data)),
  });
  await page.getByRole("button", { name: "確認して復元" }).click();
  await expect(page.getByText(/バックアップを復元しました/)).toBeVisible();
  await page.getByLabel("音声品質").selectOption("data");
  await page.getByLabel("表示").selectOption("light");
  await page.getByText("通信量と読み込みの詳細設定").click();
  await page.getByRole("checkbox", { name: "次曲の事前読み込み" }).uncheck();
  await page.goto("#queue");
  const last = page.locator("main .trackrow").last();
  await last.locator("summary").click();
  await last.getByRole("button", { name: "上へ移動" }).click();
  await page.getByRole("button", { name: "キューを保存" }).click();
  await page.goto("#playing");
  const volume = page.getByLabel("再生画面の音量");
  await volume.press("Home");
  await expect(page.getByLabel("音量", { exact: true })).toHaveValue("0");
  await page.reload();
  await expect(volume).toHaveValue("0");
  await page.goto("#settings");
  await expect(page.getByLabel("音声品質")).toHaveValue("data");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "JSONを書き出す" }).click();
  const download = await downloadEvent;
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const backup = JSON.parse(Buffer.concat(chunks).toString());
  expect(backup.queue).toEqual([ids[0], ids[2], ids[1]]);
  expect(backup.playlists[0].tracks).toEqual(backup.queue);
  expect(backup.settings.prefetch).toBe(false);
});

test("playlist edit, cover, deletion and undo change saved data", async ({ page }) => {
  await mockMusic(page);
  await page.goto("./#library");
  await page.getByLabel("新しいプレイリスト名").fill("Before edit");
  await page.getByRole("button", { name: "作成", exact: true }).click();
  await page.getByRole("button", { name: "編集", exact: true }).click();
  await page.locator("main").getByLabel("プレイリスト名", { exact: true }).fill("After edit");
  await page.getByLabel("説明文", { exact: true }).fill("Saved description");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2GQAAAAASUVORK5CYII=", "base64");
  await page.getByLabel("カバー画像を選ぶ").setInputFiles({ name: "cover.png", mimeType: "image/png", buffer: png });
  const cover = page.locator("main img[src^='data:image/']");
  await expect(cover).toBeVisible();
  const originalCover = await cover.getAttribute("src");
  await page.getByText("画像URLで指定する", { exact: true }).click();
  const coverUrl = page.getByLabel("カバー画像URL");
  await coverUrl.fill("not a valid URL");
  await coverUrl.press("Tab");
  await expect(page.getByText("画像はHTTPS URLを入力してください")).toBeVisible();
  await expect(cover).toHaveAttribute("src", originalCover!);
  await page.reload();
  await expect(page.getByRole("heading", { name: "After edit", exact: true })).toBeVisible();
  await expect(page.getByText("Saved description")).toBeVisible();
  await expect(page.locator("main img[src^='data:image/']")).toBeVisible();
  await page.getByRole("button", { name: "編集", exact: true }).click();
  await page.getByRole("button", { name: "プレイリスト削除" }).click();
  await page.getByRole("button", { name: "削除を確定" }).click();
  await expect(page.locator(".playlist-card")).toHaveCount(0);
  await page.getByRole("button", { name: "元に戻す", exact: true }).click();
  await expect(page.locator(".playlist-card")).toContainText("After edit");
  await page.getByRole("button", { name: "やり直す", exact: true }).click();
  await expect(page.locator(".playlist-card")).toHaveCount(0);
});


test("play after the last track naturally ends restarts at the beginning", async ({ page }) => {
  await mockMusic(page);
  const data = emptyData();
  const track = { ...placeholder(ids[0]), title: titles[0], duration: 8 };
  data.tracks = { [track.id]: track };
  data.queue = [track.id];
  data.current = 0;
  data.position = 5;
  await page.goto("./#settings");
  await page.locator("input[type=file]").setInputFiles({
    name: "position.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(data)),
  });
  await page.getByRole("button", { name: "確認して復元" }).click();
  await expect(page.getByText(/バックアップを復元しました/)).toBeVisible();
  await page.locator(".play-toggle").click();
  await expect(page.locator(".mini-track")).toContainText("再生中");
  await expect(page.locator(".mini-track")).toContainText("再生待ち", { timeout: 14000 });
  await expect(page.getByLabel("再生位置", { exact: true })).toHaveValue("0");
  await page.locator(".play-toggle").click();
  await progresses(page, track.id);
  expect(Number(await page.getByLabel("再生位置", { exact: true }).inputValue())).toBeLessThan(5);
});
