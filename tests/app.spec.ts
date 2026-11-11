import { test, expect, type Page } from "@playwright/test";
const id1 = "M7lc1UVf-VE",
  id2 = "aqz-KE-bpKQ";
async function mocks(page: Page) {
  await page.route("https://**/*", (r) => {
    const url = new URL(r.request().url());
    if (url.pathname.startsWith("/api/v1/")) {
      const headers = { "access-control-allow-origin": "*" };
      if (url.pathname.startsWith("/api/v1/videos/")) {
        const id = url.pathname.split("/").at(-1);
        return r.fulfill({headers,json:{
          videoId:id,title:id===id1?"Test Cover A":"Test Cover B",
          author:"Singer",authorUrl:"/channel/UCtest",lengthSeconds:60,
          videoThumbnails:[],adaptiveFormats:[],formatStreams:[],
          recommendedVideos:[{type:"video",videoId:id2,title:"Test Cover B",author:"Singer",lengthSeconds:60}],
        }});
      }
      if (url.pathname === "/api/v1/search/suggestions")
        return r.fulfill({headers,json:{query:url.searchParams.get("q"),suggestions:["Test Cover"]}});
      if (url.pathname === "/api/v1/search")
        return r.fulfill({headers,json:[
          {type:"video",videoId:id1,title:"Test Cover A",author:"Singer",lengthSeconds:60,videoThumbnails:[]},
          {type:"video",videoId:id2,title:"Test Cover B",author:"Singer",lengthSeconds:60,videoThumbnails:[]},
        ]});
      return r.fulfill({headers,json:[]});
    }
    return r.continue();
  });
}
async function goto(page: Page, route: string) {
  await page.goto("#" + route);
}
test("library / URL import / persistence / undo / command preview", async ({
  page,
}) => {
  await mocks(page);
  await page.goto("./");
  await expect(page.getByRole("heading", { name: /次の一曲に/ })).toBeVisible();
  await goto(page, "import");
  await page
    .getByLabel("曲一覧", { exact: true })
    .fill(`1. https://youtu.be/${id1}\n2. https://youtu.be/${id2}`);
  await page.getByRole("button", { name: "検索・照合する" }).click();
  await expect(page.getByText(/確定 2/)).toBeVisible();
  await page.getByRole("button", { name: "確定した曲を登録" }).click();
  await goto(page, "library");
  await expect(
    page.locator(".playlist-card").getByText("取り込んだ曲", { exact: true }),
  ).toBeVisible();
  await page.locator(".playlist-card").click();
  await expect(page.locator(".trackrow")).toHaveCount(2);
  await page.reload();
  await expect(page.locator(".trackrow")).toHaveCount(2);
  await page.getByRole("button", { name: "編集", exact: true }).click();
  await page.getByRole("button", { name: "複製", exact: true }).click();
  await page.getByRole("button", { name: "元に戻す", exact: true }).click();
  await goto(page, "library");
  await expect(page.locator(".playlist-card")).toHaveCount(1);
  await page.getByRole("button", { name: "やり直す", exact: true }).click();
  await expect(page.locator(".playlist-card")).toHaveCount(2);
  await goto(page, "library");
  await page.locator(".playlist-card").getByText("取り込んだ曲", { exact: true }).click();
  await page.getByRole("button", { name: "まとめて編集", exact: true }).click();
  await page.getByLabel("操作内容").fill("曲名順に並べ替え");
  await page.getByRole("button", { name: "変更をプレビュー" }).click();
  await expect(
    page.getByRole("button", { name: "この変更を実行" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "この変更を実行" }).click();
  await expect(page.getByRole("status")).toContainText("変更しました");
});
test("search and queue preserve video identity", async ({ page }) => {
  await mocks(page);
  await page.goto("./#search");
  await page.getByLabel("楽曲を検索").fill("Test Cover");
  await page.getByRole("button", { name: "検索", exact: true }).click();
  await expect(page.locator(".trackrow")).toHaveCount(2);
  await page.getByRole("checkbox", { name: "Test Cover Aを選択" }).check();
  await page.getByRole("button", { name: "選択した曲を追加" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "追加する" })
    .click();
  await goto(page, "library");
  await expect(page.locator(".playlist-card")).toHaveCount(1);
  await page.locator(".playlist-card").click();
  await expect(page.locator(".trackrow")).toHaveCount(1);
});
test("responsive navigation and no horizontal overflow", async ({ page }) => {
  await mocks(page);
  await page.goto("./");
  await expect(page.getByRole("heading", { name: /次の一曲に/ })).toBeVisible();
  for (const route of [
    "home",
    "search",
    "library",
    "radio",
    "import",
    "settings",
    "queue",
  ]) {
    await goto(page, route);
    await expect(page.locator("main")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
  }
  await page.screenshot({
    path: `test-results/layout-${test.info().project.name}.png`,
    fullPage: true,
  });
});
test("API failure is an error, never a false search success", async ({
  page,
}) => {
  await page.route("https://**/*", (r) =>
    new URL(r.request().url()).pathname.startsWith("/api/v1/")
      ? r.fulfill({ status: 503, body: "unavailable" })
      : r.continue(),
  );
  await page.goto("./#search");
  await page.getByLabel("楽曲を検索").fill("unavailable music query");
  await page.getByRole("button", { name: "検索", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Invidious APIに接続できません");
  await expect(page.locator(".trackrow")).toHaveCount(0);
});

function testTone(seconds = 10) {
  const rate = 8000,
    samples = rate * seconds,
    bytes = Buffer.alloc(44 + samples * 2);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(36 + samples * 2, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24);
  bytes.writeUInt32LE(rate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++)
    bytes.writeInt16LE(
      Math.round(Math.sin((i * 2 * Math.PI * 440) / rate) * 1000),
      44 + i * 2,
    );
  return bytes;
}
test("decoded test audio: pause, seek, ended auto-next, route changes and radio refill", async ({
  page,
}) => {
  await mocks(page);
  await page.route("https://**/api/v1/videos/**", (r) =>
    r.fulfill({
      json: {
        title: r.request().url().includes(id1)
          ? "Test Cover A"
          : "Test Cover B",
        author: "Singer",
        uploaderUrl: "/channel/UCtest",
        videoThumbnails: [],
        lengthSeconds: 10,
        adaptiveFormats: [
          {
            url: "https://audio.musicpleasure.test/tone.wav",
            type: "audio/wav",
            bitrate: 128000,
          },
        ],
        recommendedVideos: [
          {
            videoId: id2,
            title: "Test Cover B",
            author: "Singer",
            lengthSeconds: 10,
          },
        ],
      },
    }),
  );
  await page.route("https://audio.musicpleasure.test/**", (r) =>
    r.fulfill({
      contentType: "audio/wav",
      body: testTone(),
      headers: { "access-control-allow-origin": "*", "accept-ranges": "bytes" },
    }),
  );
  await page.goto("./#search");
  await page.getByLabel("楽曲を検索").fill("Test Cover");
  await page.getByRole("button", { name: "検索", exact: true }).click();
  await page.getByRole("button", { name: "すべて再生", exact: true }).click();
  await expect(page.locator(".mini-track")).toContainText("再生中");
  await page.getByRole("button", { name: "ミニプレーヤーを閉じる" }).click();
  await expect(page.locator(".playerbar")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "ミニプレーヤーを再表示" })).toBeVisible();
  await page.getByRole("button", { name: "ミニプレーヤーを再表示" }).click();
  await expect(page.locator(".mini-track")).toContainText("再生中");
  await page.locator(".play-toggle").click();
  await expect(page.locator(".mini-track")).toContainText("一時停止");
  await page.locator(".play-toggle").click();
  await expect(page.locator(".mini-track")).toContainText("再生中");
  await page.getByLabel("再生位置", { exact: true }).fill("9");
  await expect(page.locator(".mini-track")).toContainText("Test Cover B", {
    timeout: 10000,
  });
  await expect(page.locator(".mini-track")).toContainText("再生中");
  await goto(page, "home");
  await expect(page.locator(".mini-track")).toContainText("Test Cover B");
  await goto(page, "radio");
  await page.getByRole("button", { name: "ラジオを開始", exact: true }).click();
  await goto(page, "queue");
  await expect.poll(() => page.locator(".trackrow").count()).toBeGreaterThan(1);
});

test("a refused middle song is skipped automatically without stopping the playlist", async ({
  page,
}) => {
  await mocks(page);
  const third = "jfKfPfyJRdk";
  await page.route("https://**/api/v1/videos/**", (r) =>
    r.request().url().includes(id2)
      ? r.fulfill({
          status: 500,
          json: { error: "SignInConfirmNotBotException LOGIN_REQUIRED" },
        })
      : r.fulfill({
          json: {
            title: r.request().url().includes(id1)
              ? "First playable"
              : "Last playable",
            author: "Singer",
            lengthSeconds: 10,
            videoThumbnails: [],
            recommendedVideos: [],
            adaptiveFormats: [
              {
                url: "https://audio.musicpleasure.test/tone.wav",
                type: "audio/wav",
                bitrate: 128000,
              },
            ],
          },
        }),
  );
  await page.route("https://audio.musicpleasure.test/**", (r) =>
    r.fulfill({
      contentType: "audio/wav",
      body: testTone(),
      headers: { "access-control-allow-origin": "*" },
    }),
  );
  await page.goto("./#import");
  await page
    .getByLabel("曲一覧", { exact: true })
    .fill(
      `https://youtu.be/${id1}\nhttps://youtu.be/${id2}\nhttps://youtu.be/${third}`,
    );
  await page.getByRole("button", { name: "検索・照合する" }).click();
  await expect(page.getByText(/確定 3/)).toBeVisible();
  await page.getByRole("button", { name: "確定した曲を登録" }).click();
  await goto(page, "library");
  await page.locator(".playlist-card").click();
  await page
    .locator("main")
    .getByRole("button", { name: "再生", exact: true })
    .click();
  await expect(page.locator(".mini-track")).toContainText("First playable");
  await expect(page.locator(".mini-track")).toContainText("再生中");
  await page.getByLabel("再生位置", { exact: true }).fill("9");
  await expect(page.locator(".mini-track")).toContainText("Last playable", {
    timeout: 15000,
  });
  await expect(page.locator(".mini-track")).toContainText("再生中");
  await goto(page, "settings");
  const diag = JSON.parse(
    (await page.getByTestId("playback-diagnostics").textContent()) || "{}",
  );
  expect(
    diag.events.some(
      (e: any) =>
        e.trackId === id2 && e.stage === "queue" && e.outcome === "skip",
    ),
  ).toBe(true);
  expect(diag.excluded[id2].kind).toBe("upstream_rejected");
});

test("search does not enqueue candidates; tapping a result plays only that track", async ({ page }) => {
  await mocks(page);
  await page.goto("./#search");
  await page.getByLabel("楽曲を検索").fill("Test Cover");
  await page.getByRole("button", { name: "検索", exact: true }).click();
  await expect(page.locator(".trackrow")).toHaveCount(2);
  await goto(page, "queue");
  await expect(page.locator(".trackrow")).toHaveCount(0);

  await goto(page, "search");
  await page.getByLabel("楽曲を検索").fill("Test Cover");
  await page.getByRole("button", { name: "検索", exact: true }).click();
  await expect(page.locator(".trackrow")).toHaveCount(2);
  await page.getByRole("button", { name: "Test Cover Bを再生" }).click();
  await goto(page, "queue");
  await expect(page.locator(".trackrow")).toHaveCount(1);
  await expect(page.locator(".trackrow").first()).toContainText("Test Cover B");

  await goto(page, "search");
  await page.getByLabel("楽曲を検索").fill("Test Cover");
  await page.getByRole("button", { name: "検索", exact: true }).click();
  await expect(page.locator(".trackrow")).toHaveCount(2);
  await page.getByRole("button", { name: "すべて再生", exact: true }).click();
  await goto(page, "queue");
  await expect(page.locator(".trackrow")).toHaveCount(2);
});

test("UI quality: home actions are obvious and directly navigate to their destination", async ({ page }) => {
  await mocks(page);
  await page.goto("./");
  await expect(page.getByRole("heading", { name: "次の一曲に、出会おう。" })).toBeVisible();
  const home = page.locator(".home-dashboard");
  await expect(home.getByRole("link", { name: /曲を検索する/ })).toBeVisible();
  await expect(home.getByRole("link", { name: /プレイリストを見る/ })).toBeVisible();
  await home.getByRole("link", { name: /曲を検索する/ }).click();
  await expect(page.getByRole("heading", { name: "聴きたい曲を探す" })).toBeVisible();
  await expect(page.getByText("検索するだけではキューは変わりません。")).toBeVisible();
});

test("UI quality: technical connection details are opt-in, not shown by default", async ({ page }) => {
  await mocks(page);
  await page.goto("./#settings");
  const troubleshooting = page.locator(".troubleshooting");
  await expect(troubleshooting).not.toHaveAttribute("open");
  await troubleshooting.locator("summary").first().click();
  const details = page.locator(".advanced-instance-list");
  await expect(details).toBeVisible();
  await expect(details).not.toHaveAttribute("open");
  await details.locator("summary").click();
  await expect(details).toHaveAttribute("open", "");
});

test("UI quality: mobile and tablet primary actions are usable touch targets", async ({ page }) => {
  await mocks(page);
  await page.goto("./");
  const controls = page.locator(".home-primary-actions .button");
  await expect(controls).toHaveCount(2);
  for (const control of await controls.all()) {
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  await page.goto("./#search");
  const search = page.getByRole("button", { name: "検索", exact: true });
  const bounds = await search.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.height).toBeGreaterThanOrEqual(44);
});

test("mini player can be dismissed and restored across routes and reloads", async ({ page }) => {
  await mocks(page);
  await page.goto("./");
  await expect(page.locator(".playerbar")).toBeVisible();
  await page.getByRole("button", { name: "ミニプレーヤーを閉じる" }).click();
  await expect(page.locator(".playerbar")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "ミニプレーヤーを再表示" })).toBeVisible();
  await goto(page, "search");
  await expect(page.getByRole("heading", { name: "聴きたい曲を探す" })).toBeVisible();
  await expect(page.locator(".playerbar")).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".playerbar")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "ミニプレーヤーを再表示" })).toBeVisible();
  const box = await page.getByRole("button", { name: "ミニプレーヤーを再表示" }).boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.getByRole("button", { name: "ミニプレーヤーを再表示" }).click();
  await expect(page.locator(".playerbar")).toBeVisible();
  await expect(page.getByRole("button", { name: "ミニプレーヤーを閉じる" })).toBeVisible();
  await page.reload();
  await expect(page.locator(".playerbar")).toBeVisible();
});

test("search chooses between videos and channels without misleading cover or official filters", async ({ page }) => {
  await mocks(page);
  const modes: string[] = [];
  await page.route("https://**/api/v1/search?*", async (route) => {
    const url = new URL(route.request().url());
    modes.push(url.searchParams.get("type") || "");
    await route.fulfill({
      headers: { "access-control-allow-origin": "*" },
      json: url.searchParams.get("type") === "channel"
        ? [{ type: "channel", author: "Singer", authorId: "UCexample", authorUrl: "/channel/UCexample" }]
        : [{ type: "video", videoId: id1, title: "Test Cover A", author: "Singer", lengthSeconds: 60, videoThumbnails: [] }],
    });
  });
  await page.goto("./#search");
  await expect(page.getByRole("button", { name: "公式曲のみ" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "歌ってみた優先" })).toHaveCount(0);
  await page.getByLabel("楽曲を検索").fill("Singer");
  await page.getByRole("button", { name: "検索", exact: true }).click();
  await expect(page.locator(".trackrow")).toHaveCount(1);
  await page.getByRole("button", { name: "チャンネル", exact: true }).click();
  await expect(page.getByRole("button", { name: "チャンネル", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => modes.includes("channel")).toBe(true);
  await expect(page.locator(".trackrow")).toHaveCount(0);
  await page.getByRole("button", { name: "曲・動画", exact: true }).click();
  await expect(page.getByRole("button", { name: "曲・動画", exact: true })).toHaveAttribute("aria-pressed", "true");
  // Cached video search results are reused without a second network request.
  await expect(page.locator(".trackrow")).toHaveCount(1);
  await expect(page.locator(".trackrow")).toContainText("Test Cover A");
});

test("library uses four main navigation items, integrates tools, and protects playlist deletion", async ({ page }) => {
  await mocks(page);
  await page.goto("./#library");
  const nav = page.locator(".sidebar nav[aria-label='メインナビゲーション'] a");
  await expect(nav).toHaveCount(4);
  await expect(page.getByRole("button", { name: "歌い手", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "曲を追加", exact: true }).click();
  await expect(page.getByLabel("曲一覧", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "オフライン音楽", exact: true }).click();
  await expect(page.getByRole("heading", { name: "保存した音楽" })).toBeVisible();
  await page.getByRole("button", { name: "プレイリスト", exact: true }).click();
  await page.getByLabel("新しいプレイリスト名").fill("確認用");
  await page.getByRole("button", { name: "作成", exact: true }).click();
  await page.getByRole("button", { name: "編集", exact: true }).click();
  await page.getByRole("button", { name: "プレイリスト削除" }).click();
  await expect(page.getByRole("button", { name: "削除を確定" })).toBeVisible();
  await page.getByRole("button", { name: "キャンセル" }).click();
  await expect(page.getByRole("heading", { name: "確認用" })).toBeVisible();
});

test("radio offers simple choices and keeps detailed artist actions in song menus", async ({ page }) => {
  await mocks(page);
  await page.goto("./#radio");
  await expect(page.getByRole("button", { name: "おまかせ" })).toBeVisible();
  await expect(page.getByRole("button", { name: "新しい曲を多めに" })).toBeVisible();
  await expect(page.getByText(/発見度/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "歌ってみた特化" })).toHaveCount(0);
  await page.goto("./#search");
  await page.getByLabel("楽曲を検索").fill("Test Cover");
  await page.getByRole("button", { name: "検索", exact: true }).click();
  await page.locator(".trackrow").first().locator("summary").click();
  await expect(page.getByRole("button", { name: "この歌い手の曲を続けて聴く" })).toBeVisible();
  await expect(page.getByRole("button", { name: "この曲の別バージョンを探す" })).toBeVisible();
  await expect(page.getByRole("button", { name: "この曲はおすすめしない" })).toHaveCount(0);
});

test("queue clear requires confirmation and never removes playlists", async ({ page }) => {
  await mocks(page);
  await page.goto("./#search");
  await page.getByLabel("楽曲を検索").fill("Test Cover");
  await page.getByRole("button", { name: "検索", exact: true }).click();
  await page.getByRole("button", { name: "すべて再生", exact: true }).click();
  await page.goto("./#queue");
  await expect(page.locator(".trackrow")).toHaveCount(2);
  await page.getByRole("button", { name: "キューを空にする" }).click();
  await expect(page.locator(".trackrow")).toHaveCount(2);
  await page.getByRole("button", { name: "キャンセル" }).click();
  await expect(page.locator(".trackrow")).toHaveCount(2);
  await page.getByRole("button", { name: "キューを空にする" }).click();
  await page.getByRole("button", { name: "削除を確定" }).click();
  await expect(page.locator(".trackrow")).toHaveCount(0);
});

test("Aurora Pulse identity is visible and install icons are valid images", async ({ page }) => {
  await page.goto("./#home");
  await expect(page.locator(".home-kicker img")).toBeVisible();
  await expect(page.locator(".hero-visual img")).toBeVisible();
  await expect(page.locator(".home-welcome")).toBeVisible();
  const icons = await page.evaluate(async () => {
    const paths = ["icon.svg", "icon-192.png", "icon-512.png"];
    return Promise.all(paths.map(async (path) => {
      const img = new Image();
      img.src = new URL(path, document.baseURI).href;
      await img.decode();
      return { path, width: img.naturalWidth, height: img.naturalHeight };
    }));
  });
  expect(icons).toEqual([
    { path: "icon.svg", width: 512, height: 512 },
    { path: "icon-192.png", width: 192, height: 192 },
    { path: "icon-512.png", width: 512, height: 512 },
  ]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});
