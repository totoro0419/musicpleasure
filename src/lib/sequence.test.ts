import { describe, it, expect, vi } from "vitest";
import { QueueTraversal, type QueueContext } from "./sequence";
import { placeholder } from "./model";
import { PlaybackError } from "./reliability";
import type { LoadResult } from "./player";
function context(queue = ["bad", "good"]): QueueContext {
  let current = 0;
  return {
    queue: () => queue,
    current: () => current,
    track: (id) => ({ ...placeholder("M7lc1UVf-VE"), id }),
    excluded: () => false,
    wrap: () => false,
    select: vi.fn((i) => {
      current = i;
    }),
    load: vi.fn(async (t) =>
      t.id === "good"
        ? { status: "playing" }
        : {
            status: "failed",
            error: new PlaybackError("upstream_rejected", "blocked"),
          },
    ) as QueueContext["load"],
    skip: vi.fn(),
    replenish: vi.fn(async () => {}),
    exhausted: vi.fn(),
  };
}
describe("failure-tolerant queue traversal", () => {
  it("skips a refused track and plays the next available one", async () => {
    const c = context();
    await new QueueTraversal(c).run(0);
    expect(c.current()).toBe(1);
    expect(c.load).toHaveBeenCalledTimes(2);
    expect(c.skip).toHaveBeenCalledWith("bad", "blocked");
  });
  it("does not stop after a small arbitrary number of bad songs", async () => {
    const c = context([
      ...Array.from({ length: 12 }, (_, i) => "bad" + i),
      "good",
    ]);
    await new QueueTraversal(c).run(0);
    expect(c.current()).toBe(12);
    expect(c.load).toHaveBeenCalledTimes(13);
  });
  it("does not retry duplicate failed video ids before a later good song", async () => {
    const c = context(["bad", "bad", "good"]);
    await new QueueTraversal(c).run(0);
    expect(c.load).toHaveBeenCalledTimes(2);
    expect(c.current()).toBe(2);
  });
  it("does not stop on an API failure for one video when a later cached video is playable", async () => {
    const c = context();
    c.load = vi.fn<QueueContext["load"]>(async (t) =>
      t.id === "good"
        ? { status: "playing" }
        : {
            status: "failed",
            error: new PlaybackError("api_unavailable", "api down"),
          },
    );
    await new QueueTraversal(c).run(0);
    expect(c.current()).toBe(1);
  });
  it("repeat-all never endlessly retries an entirely failed queue", async () => {
    const c = context(["bad1", "bad2"]);
    c.wrap = () => true;
    await new QueueTraversal(c).run(0);
    expect(c.load).toHaveBeenCalledTimes(2);
    expect(c.exhausted).toHaveBeenCalledTimes(1);
  });
  it("retains the queue and stops after one finite pass during an API outage", async () => {
    const c = context(["a", "b"]);
    c.load = vi.fn<QueueContext["load"]>(async () => ({
      status: "failed",
      error: new PlaybackError("api_unavailable", "all endpoints failed"),
    }));
    await new QueueTraversal(c).run(0);
    expect(c.queue()).toEqual(["a", "b"]);
    expect(c.load).toHaveBeenCalledTimes(2);
    expect(c.exhausted).toHaveBeenCalledTimes(1);
  });
  it("does not skip autoplay restrictions as if a song were unplayable", async () => {
    const c = context();
    c.load = vi.fn<QueueContext["load"]>(async () => ({ status: "blocked" }));
    await new QueueTraversal(c).run(0);
    expect(c.load).toHaveBeenCalledTimes(1);
    expect(c.current()).toBe(0);
    expect(c.skip).not.toHaveBeenCalled();
  });
  it("pause/stop cancels auto-advance after a late failure", async () => {
    const c = context();
    let finish!: (r: LoadResult) => void;
    c.load = vi.fn<QueueContext["load"]>(
      () => new Promise<LoadResult>((r) => (finish = r)),
    );
    const runner = new QueueTraversal(c),
      pending = runner.run(0);
    runner.cancel();
    finish({
      status: "failed",
      error: new PlaybackError("upstream_rejected", "late"),
    });
    await pending;
    expect(c.current()).toBe(0);
    expect(c.load).toHaveBeenCalledTimes(1);
  });
  it("an old asynchronous result cannot replace a new selection", async () => {
    const c = context();
    let finish!: (r: LoadResult) => void;
    c.load = vi.fn<QueueContext["load"]>((t) =>
      t.id === "bad"
        ? new Promise<LoadResult>((r) => (finish = r))
        : Promise.resolve({ status: "playing" }),
    );
    const runner = new QueueTraversal(c),
      old = runner.run(0);
    await runner.run(1);
    finish({ status: "failed", error: new PlaybackError("no_stream", "late") });
    await old;
    expect(c.current()).toBe(1);
    expect(c.load).toHaveBeenCalledTimes(2);
  });
  it("skips temporary exclusions without another request and allows explicit retry", async () => {
    const c = context();
    c.excluded = (id) => id === "bad";
    await new QueueTraversal(c).run(0, 0, false);
    expect(c.load).toHaveBeenCalledTimes(1);
    const d = context();
    d.excluded = () => true;
    await new QueueTraversal(d).run(0, 0, true);
    expect(d.load).toHaveBeenCalledTimes(1);
  });
  it("continues into freshly prepared radio entries when the original queue ends", async () => {
    const ids = ["bad"];
    const c = context(ids);
    c.replenish = vi.fn(async () => {
      ids.push("good");
    });
    await new QueueTraversal(c).run(0);
    expect(c.load).toHaveBeenCalledTimes(2);
    expect(c.current()).toBe(1);
  });
  it("does not skip an available song moved into a previously visited position", async () => {
    const ids = ["good", "bad"];
    const c = context(ids);
    const load = c.load;
    c.load = vi.fn(async (track, position) => {
      if (track.id === "bad") {
        ids.reverse();
        c.select(0);
      }
      return load(track, position);
    });
    await new QueueTraversal(c).run(1);
    expect(c.load).toHaveBeenCalledTimes(2);
    expect(c.queue()[c.current()]).toBe("good");
  });
  it("finds the new recommendation after a preceding queue entry was removed", async () => {
    const ids = ["earlier", "bad"];
    const c = context(ids);
    c.select(1);
    c.replenish = vi.fn(async () => {
      ids.splice(0, 1);
      c.select(0);
      ids.push("good");
    });
    await new QueueTraversal(c).run(2);
    expect(c.load).toHaveBeenCalledTimes(1);
    expect(c.queue()[c.current()]).toBe("good");
  });
});
