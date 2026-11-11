import { describe, it, expect } from "vitest";
import {
  emptyData,
  videoId,
  playlistId,
  validateBackup,
  placeholder,
  nextIndex,
  shuffleTail,
  move,
  fromItem,
} from "./model";
import { parseList, matchScore, planCommand } from "./importer";
import { rankCandidates } from "./recommend";
import { compatibleStreams } from "./invidious";
import "fake-indexeddb/auto";
import { saveData, readData } from "./storage";
const a = {
  ...placeholder("M7lc1UVf-VE"),
  title: "夜に駆ける cover",
  uploader: "Singer A",
  duration: 240,
};
const b = {
  ...placeholder("aqz-KE-bpKQ"),
  title: "夜に駆ける 歌ってみた",
  uploader: "Singer B",
  duration: 250,
};
const c = {
  ...placeholder("jfKfPfyJRdk"),
  title: "雑談 reaction",
  uploader: "Talk",
  duration: 3600,
};
describe("YouTube identity and backup integrity", () => {
  it.each([
    "https://www.youtube.com/watch?v=M7lc1UVf-VE&t=5",
    "https://youtu.be/M7lc1UVf-VE",
    "https://www.youtube.com/shorts/M7lc1UVf-VE",
    "M7lc1UVf-VE",
  ])("parses %s", (s) => expect(videoId(s)).toBe(a.id));
  it("rejects unrelated domains and invalid ids", () => {
    expect(videoId("https://evil.test/?v=" + a.id)).toBeNull();
    expect(videoId("bad")).toBeNull();
  });
  it("parses playlist URLs", () =>
    expect(playlistId("https://youtube.com/playlist?list=PLabc_123")).toBe(
      "PLabc_123",
    ));
  it("normalizes backups and strips ephemeral stream URLs", () => {
    const d = emptyData();
    d.tracks[a.id] = { ...a, url: "https://expired" } as typeof a;
    d.favorites = [a.id, a.id, "missing"];
    const v = validateBackup(d);
    expect(v.favorites).toEqual([a.id]);
    expect(v.tracks[a.id]).not.toHaveProperty("url");
  });
  it("rejects corrupted data instead of silently replacing it", () => {
    expect(() => validateBackup({ version: 99 })).toThrow();
    const d = emptyData();
    d.tracks.bad = a;
    expect(() => validateBackup(d)).toThrow();
  });
  it("rejects invalid preferences", () => {
    const d = emptyData();
    d.settings.weights.fresh = NaN;
    expect(() => validateBackup(d)).toThrow();
  });
  it("migrates schema 1 to 2", () => {
    expect(validateBackup({ ...emptyData(), version: 1 }).version).toBe(2);
  });
  it("persists latest data under overlapping writes", async () => {
    const d = emptyData();
    d.tracks[a.id] = a;
    await Promise.all([saveData(d), saveData({ ...d, favorites: [a.id] })]);
    expect((await readData()).favorites).toEqual([a.id]);
  });
});
describe("queue sequencing", () => {
  it("advances once and stops at end", () => {
    const d = { current: 0, queue: [a.id, b.id], repeat: "off" as const };
    expect(nextIndex(d, true)).toBe(1);
    expect(nextIndex({ ...d, current: 1 }, true)).toBe(-1);
  });
  it("repeat one applies only to ended events", () => {
    const d = { current: 0, queue: [a.id, b.id], repeat: "one" as const };
    expect(nextIndex(d, true)).toBe(0);
    expect(nextIndex(d, false)).toBe(1);
  });
  it("wraps repeat all", () =>
    expect(
      nextIndex({ current: 1, queue: [a.id, b.id], repeat: "all" }, true),
    ).toBe(0));
  it("shuffle preserves active and already-played entries", () => {
    const q = ["a", "b", "c", "d"];
    const s = shuffleTail(q, 1, () => 0);
    expect(s.slice(0, 2)).toEqual(["a", "b"]);
    expect(new Set(s)).toEqual(new Set(q));
    expect(shuffleTail(q, 1, () => 0)).toEqual(s);
  });
  it("reorders without mutating source", () => {
    const a = [1, 2, 3];
    expect(move(a, 0, 2)).toEqual([2, 3, 1]);
    expect(a).toEqual([1, 2, 3]);
  });
});
describe("local recommendation", () => {
  it("excludes queue/dislikes and duplicate video ids", () => {
    const d = emptyData();
    d.queue = [a.id];
    d.disliked = [c.id];
    expect(rankCandidates([a, b, b, c], a, d).map((x) => x.id)).toEqual([b.id]);
  });
  it("keeps different covers distinct and explains its choice", () => {
    const d = emptyData();
    const result = rankCandidates([b, c], a, d, "covers");
    expect(result[0].id).toBe(b.id);
    expect(result[0].reason).toContain("関連");
  });
  it("does not infer liking from plays alone", () => {
    const d = emptyData();
    d.tracks[b.id] = b;
    d.listening[b.id] = {
      plays: 5,
      seconds: 10,
      skips: 5,
      last: Date.now(),
      failed: 0,
    };
    const score = rankCandidates([b], a, d)[0].score;
    expect(score).toBeLessThan(rankCandidates([b], a, emptyData())[0].score);
  });
});
describe("batch import and command preview", () => {
  it("parses markdown numbered lists, csv-like entries and URL links", () => {
    const list = parseList(
      "# 曲一覧\n1. 曲名, 歌手\n- [video](https://youtu.be/M7lc1UVf-VE)\n- 曲名, 歌手",
    );
    expect(list).toHaveLength(2);
    expect(list[1].query).toBe("https://youtu.be/M7lc1UVf-VE");
  });
  it("gives matching covers higher confidence", () =>
    expect(matchScore("夜に駆ける cover", a)).toBeGreaterThan(
      matchScore("夜に駆ける cover", c),
    ));
  it("does not change data until a preview is applied", () => {
    const d = emptyData();
    d.tracks = { [a.id]: a, [b.id]: b };
    d.playlists = [
      {
        id: "p",
        name: "Test",
        tracks: [b.id, a.id],
        description: "",
        cover: "",
        favorite: false,
        created: 0,
      },
    ];
    const plan = planCommand("「Singer A」を抽出", "p", d);
    expect(d.playlists[0].tracks).toHaveLength(2);
    expect(plan.execute(d).playlists[0].tracks).toEqual([a.id]);
  });
  it("refuses ambiguous destructive commands", () => {
    const d = emptyData();
    d.playlists = [
      {
        id: "p",
        name: "Test",
        tracks: [],
        description: "",
        cover: "",
        favorite: false,
        created: 0,
      },
    ];
    expect(() => planCommand("適当に削除", "p", d)).toThrow();
  });
  it("normalizes actual Invidious search items", () =>
    expect(
      fromItem({
        url: "/watch?v=" + b.id,
        title: b.title,
        uploaderName: b.uploader,
        duration: 123,
      })?.id,
    ).toBe(b.id));
});
describe("codec and quality selection", () => {
  it("filters incompatible, unsafe and video streams", () => {
    const streams = [
      { url: "https://s/1", mimeType: "audio/mp4", bitrate: 128000 },
      { url: "https://s/2", mimeType: "audio/webm", bitrate: 250000 },
      { url: "http://s/3", mimeType: "audio/mp4", bitrate: 128000 },
      { url: "https://s/4", mimeType: "video/mp4", bitrate: 128000 },
    ];
    expect(
      compatibleStreams(streams, (s) => (s.includes("mp4") ? "probably" : "")),
    ).toHaveLength(1);
    expect(compatibleStreams(streams, () => "probably")[0].bitrate).toBe(
      128000,
    );
  });
});

it("restores the radio seed and generated queue without requiring new fields in older backups", () => {
  const data = emptyData();
  const seed = placeholder("M7lc1UVf-VE");
  const generated = placeholder("aqz-KE-bpKQ");
  data.tracks = { [seed.id]: seed, [generated.id]: generated };
  data.queue = [seed.id, generated.id];
  data.radio = true;
  expect(validateBackup(data).radioSeed).toBeUndefined();
  data.radioSeed = seed.id;
  data.radioGenerated = [generated.id, "dQw4w9WgXcQ"];
  const restored = validateBackup(data);
  expect(restored.radioSeed).toBe(seed.id);
  expect(restored.radioGenerated).toEqual([generated.id]);
});
