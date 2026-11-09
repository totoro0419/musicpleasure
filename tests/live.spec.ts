import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
test("public Piped playback — no API or media mocks", async ({
  page,
}, testInfo) => {
  test.skip(
    !process.env.LIVE_TESTS || testInfo.project.name !== "desktop",
    "Explicit live-network test",
  );
  test.setTimeout(180000);
  const report: Record<string, unknown> = {
    at: new Date().toISOString(),
    url: process.env.E2E_BASE_URL,
    search: "unverified",
    pipedPlayback: "unverified",
    seek: "unverified",
    pauseResume: "unverified",
    automaticNext: "unverified",
    radio: "unverified",
    errors: [],
  };
  const errors = report.errors as string[];
  async function attempt(name: string, run: () => Promise<void>) {
    try {
      await run();
      report[name] = "passed";
    } catch (e) {
      report[name] = "failed";
      errors.push(`${name}: ${String(e).slice(0, 500)}`);
    }
  }
  try {
    await page.goto("./#search");
    await attempt("search", async () => {
      await page.getByLabel("楽曲を検索").fill("歌ってみた");
      await page.getByRole("button", { name: "検索", exact: true }).click();
      await expect(page.locator(".trackrow").first()).toBeVisible({
        timeout: 30000,
      });
    });
    // Fixed IDs from Piped responses; no substitutes or mock media in this test.
    await page.goto("./#import");
    await page
      .getByLabel("曲一覧", { exact: true })
      .fill("https://youtu.be/dQw4w9WgXcQ\nhttps://youtu.be/djV11Xbc914");
    await page.getByRole("button", { name: "検索・照合する" }).click();
    await expect(page.getByText(/確定 2/)).toBeVisible({ timeout: 55000 });
    await page.getByRole("button", { name: "確定した曲を登録" }).click();
    await page.goto("./#library");
    await page.locator(".playlist-card").first().click();
    await page
      .locator("main")
      .getByRole("button", { name: "再生", exact: true })
      .click();
    await attempt("pipedPlayback", async () => {
      await expect(page.locator(".engine-badge")).toHaveText("Piped", {
        timeout: 30000,
      });
      await expect(page.locator(".mini-track")).toContainText("再生中", {
        timeout: 10000,
      });
      const start = Number(
        await page.getByLabel("再生位置", { exact: true }).inputValue(),
      );
      await expect
        .poll(
          async () =>
            Number(
              await page.getByLabel("再生位置", { exact: true }).inputValue(),
            ),
          { timeout: 8000 },
        )
        .toBeGreaterThan(start + 1);
    });
    if (report.pipedPlayback === "passed") {
      await attempt("seek", async () => {
        const slider = page.getByLabel("再生位置", { exact: true });
        await slider.press("Home");
        await slider.press("PageUp");
        await slider.press("PageUp");
        await expect
          .poll(async () => Number(await slider.inputValue()), {
            timeout: 6000,
          })
          .toBeGreaterThanOrEqual(29);
      });
      await attempt("pauseResume", async () => {
        await page.locator(".play-toggle").click();
        await expect(page.locator(".mini-track")).toContainText("一時停止");
        await page.locator(".play-toggle").click();
        await expect(page.locator(".mini-track")).toContainText("再生中");
      });
      await attempt("automaticNext", async () => {
        const slider = page.getByLabel("再生位置", { exact: true });
        const duration = Number(await slider.getAttribute("max"));
        expect(duration).toBeGreaterThan(2);
        await slider.press("End");
        await expect(page.locator(".mini-track")).not.toContainText(
          "Rick Astley",
          { timeout: 10000 },
        );
        await expect(page.locator(".mini-track")).toContainText("再生中", {
          timeout: 30000,
        });
      });
    } else {
      report.seek = "blocked: no actual audio";
      report.pauseResume = "blocked: no actual audio";
      report.automaticNext = "blocked: no actual audio";
    }
    await attempt("radio", async () => {
      await page.goto("./#radio");
      await page
        .getByRole("button", { name: "ラジオを開始", exact: true })
        .click();
      await page.goto("./#queue");
      await expect
        .poll(() => page.locator(".trackrow").count(), { timeout: 35000 })
        .toBeGreaterThan(1);
    });
  } catch (e) {
    errors.push(`setup: ${String(e)}`);
  } finally {
    await mkdir("test-results", { recursive: true });
    await writeFile(
      "test-results/live-verification.json",
      JSON.stringify(report, null, 2),
    );
    console.log("LIVE_VERIFICATION", JSON.stringify(report));
    await page
      .screenshot({ path: "test-results/live-public.png", fullPage: true })
      .catch(() => {});
    await testInfo.attach("live-results", {
      body: JSON.stringify(report, null, 2),
      contentType: "application/json",
    });
  }
  expect(
    report.pipedPlayback,
    "Audio time must advance through Piped; API JSON success alone does not count",
  ).toBe("passed");
});
