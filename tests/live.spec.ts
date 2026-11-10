import { test, expect, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import tracks from "./fixtures/invidious-tracks.json" with { type: "json" };
import { emptyData, newPlaylist } from "../src/lib/model";
test("ten real YouTube posts: Invidious media, failure skips and radio (no mocks)", async ({
  page,
}, info) => {
  test.skip(
    !process.env.LIVE_TESTS || info.project.name === "android-phone",
    "Explicit PC/tablet live service verification",
  );
  test.setTimeout(720000);
  const results: Array<Record<string, unknown>> = [];
  const report: Record<string, unknown> = {
    at: new Date().toISOString(),
    project: info.project.name,
    url: process.env.E2E_BASE_URL || "CI branch preview",
    sampleCount: tracks.length,
    coverCount: tracks.filter((t) => t.cover).length,
    tracks: results,
    automaticFailureSkip: "unverified",
    endedAdvance: "unverified",
    continuousThreeDistinct: "unverified",
    radioContinuation: "unverified",
    errors: [],
  };
  const errors = report.errors as string[];
  const diagnostics = async () => {
    if (!page.url().endsWith("#settings")) await page.goto("./#settings");
    return JSON.parse(
      (await page.getByTestId("playback-diagnostics").textContent()) || "{}",
    );
  };
  async function progresses(expectedId?: string) {
    const mini = page.locator(".mini-track");
    await expect(mini).toContainText("再生中", { timeout: 32000 });
    if (expectedId) await expect(mini).toHaveAttribute("data-track-id", expectedId);
    const slider = page.getByLabel("再生位置", { exact: true });
    // A track switch resets the seek position (e.g. 214s -> 0s).
    // Measure advancing audio *after* the reset instead of comparing against
    // the prior track's position. Also ignore artificial seek jumps.
    let previous = Number.NaN;
    let accumulated = 0;
    await expect.poll(async () => {
      const status = await mini.innerText();
      if (expectedId && await mini.getAttribute("data-track-id") !== expectedId) throw Error("Expected track was skipped or replaced before its audio progressed: " + expectedId);
      const position = Number(await slider.inputValue());
      if (!status.includes("再生中") || !Number.isFinite(position)) {
        previous = Number.NaN;
        accumulated = 0;
        return 0;
      }
      const step = position - previous;
      if (!Number.isFinite(previous) || step < -0.5 || step > 3) {
        previous = position;
        accumulated = 0;
        return 0;
      }
      if (step > 0) accumulated += step;
      previous = position;
      return accumulated;
    }, { timeout: 12000, intervals: [250, 350, 500] }).toBeGreaterThan(1);
  }
  async function restore(queue: string[]) {
    await page.goto("./#settings");
    const d = emptyData();
    for (const t of tracks) d.tracks[t.id] = { ...t };
    d.queue = queue;
    d.current = 0;
    const p = newPlaylist("実サービス検証", queue);
    d.playlists = [p];
    await page.locator("input[type=file]").setInputFiles({
      name: "live-test.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(d)),
    });
    await page
      .getByRole("button", { name: "確認して復元", exact: true })
      .click();
    return p.id;
  }
  try {
    expect(tracks.length).toBeGreaterThanOrEqual(10);
    expect(tracks.filter((t) => t.cover).length).toBeGreaterThanOrEqual(5);
    await page.goto("./#settings");
    await page
      .getByText("選択した接続先の音声再生を確認", { exact: true })
      .click();
    for (const t of tracks) {
      const started = Date.now();
      const row: Record<string, unknown> = {
        id: t.id,
        title: t.title,
        cover: t.cover,
        playback: "failed",
        prepared: false,
      };
      results.push(row);
      await page.getByLabel("検証用動画ID").fill(t.id);
      await page
        .getByRole("button", { name: "音声を検証", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "音声を検証", exact: true }),
      ).toBeEnabled({ timeout: 36000 });
      try {
        if (
          (await page.locator(".mini-track").innerText()).includes("再生中")
        ) {
          await progresses();
          row.playback = "passed";
        }
      } catch (e) {
        row.error = String(e).slice(0, 300);
      }
      const diag = await diagnostics();
      row.start = diag.starts?.find((s: { id: string; at: number }) => s.id === t.id && s.at >= started);
      const events = diag.events.filter(
        (e: { trackId: string; at: number }) =>
          e.trackId === t.id && e.at >= started,
      );
      row.prepared = events.some(
        (e: { stage: string; outcome: string }) =>
          e.stage === "probe" && e.outcome === "success",
      );
      row.diagnostics = events;
      row.elapsedMs = Date.now() - started;
      console.log(
        "LIVE_TRACK",
        JSON.stringify({ project: info.project.name, ...row }),
      );
    }
    const good = results
        .filter((r) => r.playback === "passed")
        .map((r) => String(r.id)),
      bad = results
        .filter((r) => r.playback !== "passed")
        .map((r) => String(r.id));
    report.actualPlayableCount = good.length;
    report.acquisitionCount = results.filter((r) => r.prepared).length;
    if (good.length) {
      await page
        .getByText("失敗した段階と一時除外の診断", { exact: true })
        .click();
      await page
        .getByRole("button", { name: "一時除外を解除", exact: true })
        .click();
      // A real failure is placed ahead of a known playable post, not just a mocked ended event.
      const queue = [...bad.slice(0, 2), good[0]];
      const p = await restore(queue);
      await page.goto("./#playlist/" + p);
      await page
        .locator("main")
        .getByRole("button", { name: "再生", exact: true })
        .click();
      await progresses();
      report.automaticFailureSkip = bad.length
        ? "passed"
        : "not applicable: no failing samples";
      let diag = await diagnostics();
      report.skipEvidence = diag.events.filter(
        (e: { stage: string; outcome: string }) =>
          e.stage === "queue" && e.outcome === "skip",
      );
      // Test a genuine ended event and return to the surviving source through a refused post.
      if (bad.length) {
        await restore([good[0], bad[0], good[0]]);
        await page.locator(".play-toggle").click();
        await progresses();
        const before = JSON.parse(
          (await page.getByTestId("playback-diagnostics").textContent()) ||
            "{}",
        ).events.filter(
          (e: any) =>
            e.stage === "queue" && e.outcome === "skip" && e.trackId === bad[0],
        ).length;
        await page.getByLabel("再生位置", { exact: true }).press("End");
        await expect
          .poll(
            async () => {
              const d = await page
                .getByTestId("playback-diagnostics")
                .textContent();
              return JSON.parse(d || "{}").events.filter(
                (e: { stage: string; outcome: string; trackId: string }) =>
                  e.stage === "queue" &&
                  e.outcome === "skip" &&
                  e.trackId === bad[0],
              ).length;
            },
            { timeout: 36000 },
          )
          .toBeGreaterThan(before);
        await progresses();
        report.endedAdvance =
          "passed (returns to same surviving source; not three distinct songs)";
      }
      if (good.length >= 3) {
        const p = await restore(good.slice(0, 3));
        await page.goto("./#playlist/" + p);
        await page
          .locator("main")
          .getByRole("button", { name: "再生", exact: true })
          .click();
        for (let i = 0; i < 3; i++) {
          await expect(page.locator(".mini-track")).toHaveAttribute("data-track-id", good[i], { timeout: 32000 });
          await progresses(good[i]);
          if (i < 2)
            await page.getByLabel("再生位置", { exact: true }).press("End");
        }
        report.continuousThreeDistinct = "passed";
      } else
        report.continuousThreeDistinct = `unmet: only ${good.length} distinct post(s) playable`;
      await page.goto("./#radio");
      await page
        .getByRole("button", { name: "ラジオを開始", exact: true })
        .click();
      await progresses();
      await page.goto("./#queue");
      try {
        await expect
          .poll(() => page.locator(".trackrow").count(), { timeout: 100000 })
          .toBeGreaterThan(1);
        await page.getByLabel("再生位置", { exact: true }).press("End");
        await progresses();
        report.radioContinuation = "passed";
      } catch (e) {
        report.radioContinuation = "unmet: no next playable recommendation";
        errors.push(String(e).slice(0, 250));
      }
    } else {
      report.automaticFailureSkip = "unverified: no playable live sample";
      report.continuousThreeDistinct = "unmet: 0 playable samples";
    }
    report.diagnostics = await diagnostics();
  } catch (e) {
    errors.push(String(e));
    report.diagnostics = await diagnostics().catch(() => ({}));
  } finally {
    await mkdir("test-results", { recursive: true });
    const name = "invidious-live-" + info.project.name;
    await writeFile(
      `test-results/${name}.json`,
      JSON.stringify(report, null, 2),
    );
    console.log("LIVE_VERIFICATION", JSON.stringify(report));
    await info.attach(name, {
      body: JSON.stringify(report, null, 2),
      contentType: "application/json",
    });
    await page
      .screenshot({ path: `test-results/${name}.png`, fullPage: true })
      .catch(() => {});
  }
  // A green live qualification requires the full requested three-source result, not one cached hit.
  expect(
    report.actualPlayableCount,
    "ten distinct real YouTube posts must play",
  ).toBeGreaterThanOrEqual(10);
  expect(report.continuousThreeDistinct).toBe("passed");
  expect(report.radioContinuation).toBe("passed");
});
