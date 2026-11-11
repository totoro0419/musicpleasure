import { expect, it } from "vitest";
import { emptyData, placeholder } from "./model";
import { rankCandidates } from "./recommend";

const track = (id: string, title: string, uploader: string, uploaderUrl?: string) =>
  ({ ...placeholder(id), title, uploader, uploaderUrl });
const seed = track("M7lc1UVf-VE", "Aurora Song", "Singer", "/channel/UCSinger");
const version = track("aqz-KE-bpKQ", "Aurora Song (Live)", "Singer", "/channel/UCSinger");
const familiar = track("dQw4w9WgXcQ", "Aurora Night", "Singer", "/channel/UCSinger");
const fresh = track("djV11Xbc914", "Blue Sky", "Other", "/channel/UCOther");

it("discovery boosts unplayed tracks without excluding same-artist tracks from the pool", () => {
  const data = emptyData();
  data.settings.weights = { related: 1, favorite: 0, fresh: 0, recent: 0 };
  data.listening[version.id] = { plays: 2, seconds: 120, skips: 0, last: 0, failed: 0 };
  data.listening[familiar.id] = { plays: 1, seconds: 60, skips: 0, last: 0, failed: 0 };
  expect(rankCandidates([version, familiar, fresh], seed, data, "balance").map((item) => item.id))
    .toEqual([version.id, familiar.id, fresh.id]);
  expect(rankCandidates([version, familiar, fresh], seed, data, "discovery")[0].id).toBe(fresh.id);
});

it("channel and version modes require the corresponding relationship", () => {
  const data = emptyData();
  const sameName = { ...fresh, uploader: seed.uploader };
  expect(rankCandidates([version, familiar, sameName], seed, data, "channel").map((item) => item.id))
    .toEqual([version.id, familiar.id]);
  expect(rankCandidates([version, familiar, fresh], seed, data, "versions").map((item) => item.id))
    .toEqual([version.id]);
});
