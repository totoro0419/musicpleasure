import { describe, it, expect } from "vitest";
import { parseImport } from "../parser";
describe("import parsing", () => {
  it("preserves order and detects duplicate lines", () => {
    const r = parseImport(
      "1. Artist A - Song A\n2. Artist B - Song B\n3. Artist A - Song A",
    );
    expect(r.map((r) => r.title)).toEqual(["Song A", "Song B", "Song A"]);
    expect(r[2].skip).toBe(true);
  });
  it("handles Markdown table column order", () => {
    const r = parseImport("| 曲名 | アーティスト |\n|---|---|\n| 花 | 山田 |");
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ title: "花", artist: "山田" });
  });
  it("handles quoted CSV", () => {
    expect(
      parseImport('artist,title\n"Earth, Wind & Fire","September"')[0],
    ).toMatchObject({ artist: "Earth, Wind & Fire", title: "September" });
  });
  it("handles JSON and YouTube URL lists", () => {
    expect(parseImport('[{"artist":"A","title":"T"}]')[0]).toMatchObject({
      artist: "A",
      title: "T",
    });
    expect(parseImport("https://youtu.be/abcdefghijk")[0].url).toBe(
      "https://youtu.be/abcdefghijk",
    );
  });
  it("marks ambiguous natural language instead of asserting correctness", () => {
    expect(parseImport("山田の「花」が好き")[0]).toMatchObject({
      artist: "山田",
      title: "花",
    });
    expect(parseImport("夜の曲を集めたい")[0].warning).toBeTruthy();
  });
  it("bounds input size", () => {
    expect(() => parseImport("x".repeat(1000001))).toThrow();
  });
});
