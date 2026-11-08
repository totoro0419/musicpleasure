import "fake-indexeddb/auto";
import { beforeEach, describe, it, expect } from "vitest";
import { useStore, reorder, snapshot, deduplicateEntries } from "../store";
import { db, saveSnapshot, validateSnapshot } from "../db";
import type { Track } from "../types";
const a: Track = {
  id: "a",
  title: "A",
  artist: "Artist",
  duration: 2,
  thumbnail: "",
  sources: [
    {
      id: "local:a",
      provider: "local",
      url: "",
      kind: "local",
      official: false,
      evidence: "local",
    },
  ],
};
const b = { ...a, id: "b", title: "B" };
beforeEach(() => {
  useStore.setState({
    tracks: {},
    artists: {},
    albums: {},
    playlists: [],
    favorites: [],
    queue: [],
    currentId: null,
    position: 0,
    history: [],
    past: [],
    future: [],
    loaded: false,
  });
});
describe("library and storage contracts", () => {
  it("keeps playlist order, independent queue and one track object per ID", () => {
    const id = useStore.getState().createPlaylist("test", [a, b]);
    useStore.getState().enqueue([b, a]);
    expect(
      useStore.getState().playlists[0].entries.map((e) => e.trackId),
    ).toEqual(["a", "b"]);
    expect(useStore.getState().queue.map((e) => e.trackId)).toEqual(["b", "a"]);
    useStore.getState().updatePlaylist(id, (p) => p.entries.reverse());
    expect(useStore.getState().queue.map((e) => e.trackId)).toEqual(["b", "a"]);
    expect(Object.keys(useStore.getState().tracks)).toHaveLength(2);
  });
  it("undo/redo restores playlist deletion", () => {
    const s = useStore.getState();
    const id = s.createPlaylist("test", [a]);
    s.deletePlaylist(id);
    expect(useStore.getState().playlists).toHaveLength(0);
    s.undo();
    expect(useStore.getState().playlists[0].name).toBe("test");
    s.redo();
    expect(useStore.getState().playlists).toHaveLength(0);
  });
  it("keeps queued audio references valid after undo", () => {
    useStore.getState().addTracks([a]);
    useStore.getState().enqueue([a]);
    useStore.getState().undo();
    expect(useStore.getState().tracks.a).toBeDefined();
  });
  it("deduplicates preserving the first occurrence and supports reorder", () => {
    const p = {
      id: "p",
      name: "P",
      createdAt: 0,
      entries: [
        { id: "1", trackId: "a" },
        { id: "2", trackId: "b" },
        { id: "3", trackId: "a" },
      ],
    };
    deduplicateEntries(p, { a, b });
    expect(p.entries.map((e) => e.trackId)).toEqual(["a", "b"]);
    expect(reorder([1, 2, 3], 0, 2)).toEqual([2, 3, 1]);
  });
  it("persists MP3 bytes and snapshots across a database close/reopen", async () => {
    useStore.getState().createPlaylist("persist", [a, b]);
    await db.assets.put({
      id: "local:a",
      sourceId: "local:a",
      blob: new Blob(["mp3-test"]),
      bytes: 8,
      createdAt: 0,
    });
    await saveSnapshot(snapshot(useStore.getState()));
    db.close();
    await db.open();
    expect(
      (await db.snapshots.get("current"))?.value.playlists[0].entries.map(
        (e) => e.trackId,
      ),
    ).toEqual(["a", "b"]);
    expect((await db.assets.get("local:a"))?.bytes).toBe(8);
  });
  it("rejects broken backups before mutating state and strips credentials", () => {
    const value = snapshot(useStore.getState());
    expect(() => validateSnapshot({ ...value, schema: 99 })).toThrow();
    expect(() =>
      validateSnapshot({ ...value, queue: [{ id: "q", trackId: "missing" }] }),
    ).toThrow();
    const valid = validateSnapshot({
      ...value,
      settings: {
        ...value.settings,
        token: "secret",
        apiUrl: "https://bad.test",
      },
    });
    expect(valid.settings.token).toBe("");
  });
});
