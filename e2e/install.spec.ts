import { test, expect } from "@playwright/test";

test("install prompt cancellation remains retryable through visible instructions", async ({
  page,
}) => {
  await page.goto("/");
  const button = page.getByRole("button", {
    name: "MusicPleasureをインストール",
    exact: true,
  });
  await expect(button).toBeVisible();
  await page.evaluate(() => {
    const event = new Event("beforeinstallprompt", { cancelable: true });
    Object.defineProperties(event, {
      prompt: { value: () => Promise.resolve() },
      userChoice: { value: Promise.resolve({ outcome: "dismissed" }) },
    });
    window.dispatchEvent(event);
  });
  await button.click();
  await expect(page.getByRole("status")).toContainText("キャンセル");
  await button.click();
  await expect(
    page.getByRole("dialog", {
      name: "MusicPleasureをインストール",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "わかりました", exact: true }).click();
  await page.evaluate(() => window.dispatchEvent(new Event("appinstalled")));
  await expect(button).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
});

test("manifest includes installable PNG sizes under the current base path", async ({
  page,
  request,
}) => {
  await page.goto("/");
  const manifestHref = await page
    .locator("link[rel=manifest]")
    .getAttribute("href");
  const response = await request.get(manifestHref!);
  expect(response.ok()).toBe(true);
  const manifest = await response.json();
  for (const size of ["192x192", "512x512"]) {
    const icon = manifest.icons.find(
      (i: { sizes: string }) => i.sizes === size,
    );
    expect(icon.type).toBe("image/png");
    const image = await request.get(
      new URL(icon.src, new URL(manifestHref!, page.url())).href,
    );
    expect(image.ok()).toBe(true);
  }
});
