"""Derive a stricter isolated test; preserve the original live test and fixture."""
from pathlib import Path
root = Path(__file__).resolve().parents[1]
source = (root / 'tests/live.spec.ts').read_text()


def replace_once(old, new):
    global source
    if source.count(old) != 1:
        raise ValueError('Live test changed; refusing an ambiguous diagnostic modification')
    source = source.replace(old, new)


replace_once('  const results: Array<Record<string, unknown>> = [];', '''  const trialInstance = "https://localhost:8443/api";
  const results: Array<Record<string, unknown>> = [];''')
replace_once('    sampleCount: tracks.length,', '    instance: trialInstance,\n    sampleCount: tracks.length,')
replace_once('    d.current = 0;', '    d.current = 0;\n    d.settings.instance = trialInstance;')
anchor = '''    await page.goto("./#settings");
    await page
      .getByText("選択した接続先の音声再生を確認", { exact: true })'''
replace_once(anchor, '''    await page.goto("./#settings");
    await page.getByText("任意の接続先を追加", {exact:true}).click();
    await page.getByLabel("Piped API URL", {exact:true}).fill(trialInstance);
    await page.getByRole("button", {name:"追加", exact:true}).click();
    await page.getByRole("combobox", {name:"接続先", exact:true}).selectOption(trialInstance);
    await page
      .getByText("選択した接続先の音声再生を確認", { exact: true })''')
replace_once('''      row.prepared = events.some(''', '''      row.playInstances = events.filter((e: any) => e.stage === "play" && e.outcome === "success").map((e: any) => e.instance);
      if (row.playback === "passed" && !(row.playInstances as string[]).includes(trialInstance)) {
        row.playback = "failed: playback used a different Piped instance";
      }
      row.prepared = events.filter((e: any) => e.instance === trialInstance).some(''')
replace_once('''      row.elapsedMs = Date.now() - started;''', '''      if (row.playback === "passed") {
        const slider = page.getByLabel("再生位置", {exact:true});
        await page.locator(".play-toggle").click();
        await expect(page.locator(".mini-track")).toContainText("一時停止");
        const paused = Number(await slider.inputValue());
        await page.waitForTimeout(1200);
        expect(Math.abs(Number(await slider.inputValue()) - paused)).toBeLessThan(0.25);
        await page.locator(".play-toggle").click();
        await progresses();
        row.pauseResume = "passed";
        await slider.press("Home");
        await expect.poll(async () => Number(await slider.inputValue())).toBeLessThan(5);
        await progresses();
        row.seek = "passed";
      }
      row.elapsedMs = Date.now() - started;''')
replace_once('''      if (good.length >= 3) {
        const p''', '''      if (good.length >= 3) {
        const sequenceStarted = Date.now();
        const p''')
replace_once('''        for (let i = 0; i < 3; i++) {
          await progresses();''', '''        const sequenceStarted = Date.now();
        for (let i = 0; i < 3; i++) {
          await expect.poll(async () => {
            const d = await diagnostics();
            return d.events.some((e: any) => e.trackId === good[i] && e.instance === trialInstance && e.stage === "play" && e.outcome === "success" && e.at >= sequenceStarted);
          }, {timeout:36000}).toBe(true);
          await progresses();''')
source = source.replace('''        const sequenceStarted = Date.now();
        for (let i''', '''        for (let i''')
replace_once('''      await page.goto("./#radio");''', '''      const radioStarted = Date.now();
      await page.goto("./#radio");''')
replace_once('''        report.radioContinuation = "passed";''', '''        const rd = await diagnostics();
        const radioIds = [...new Set(rd.events.filter((e: any) => e.at >= radioStarted && e.stage === "play" && e.outcome === "success" && e.instance === trialInstance).map((e: any) => e.trackId))];
        expect(radioIds.length).toBeGreaterThan(1);
        report.radioDistinctIds = radioIds;
        report.radioContinuation = "passed";''')
# Every original acceptance assertion remains present; no mocks, fixture swaps,
# browser certificate bypasses or changes to MusicPleasure's playback engine.
for assertion in ['.toBeGreaterThanOrEqual(10)', '.toBeGreaterThanOrEqual(5)',
                  ').toBeGreaterThanOrEqual(3)', 'expect(report.continuousThreeDistinct).toBe("passed")',
                  'expect(report.radioContinuation).toBe("passed")']:
    if assertion not in source:
        raise ValueError('Required original live qualification assertion missing')
target = root / 'tests/piped-self-host.spec.ts'
if target.exists():
    raise FileExistsError('Refusing to replace an existing test file')
target.write_text(source)
