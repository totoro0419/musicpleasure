import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import vm from "node:vm";
async function generatedWorker() {
  const source = readFileSync("scripts/build-sw.mjs", "utf8").replace(
    /^import .*;\n/gm,
    "",
  );
  let output = "";
  await vm.runInNewContext(`(async()=>{${source}})()`, {
    createHash,
    readdir: async () => ["app.js"],
    readFile: async () => Buffer.from("<html>v2</html>"),
    writeFile: async (_p: string, text: string) => {
      output = text;
    },
    console: { log: () => {} },
  });
  return output;
}
async function boot(names: string[], active = true) {
  const hooks: Record<string, (event: any) => void> = {};
  const removed: string[] = [];
  const skipWaiting = vi.fn(async () => {}),
    claim = vi.fn(async () => {});
  const caches = {
    keys: async () => names,
    open: async () => ({ addAll: async () => {} }),
    delete: async (k: string) => {
      removed.push(k);
      return true;
    },
    match: vi.fn(async () => new Response("offline v2")),
  };
  vm.runInNewContext(await generatedWorker(), {
    self: {
      registration: {
        scope: "https://example.test/musicpleasure/",
        active: active ? {} : undefined,
      },
      location: { origin: "https://example.test" },
      addEventListener: (name: string, fn: any) => (hooks[name] = fn),
      skipWaiting,
      clients: { claim },
    },
    caches,
    URL,
    Request,
    fetch: async () => {
      throw Error("offline");
    },
  });
  return { hooks, removed, skipWaiting, claim, caches };
}
describe("service worker migration and update lifecycle", () => {
  it("activates over the old Workbox cache and leaves other apps alone", async () => {
    const own = "workbox-precache-v2-https://example.test/musicpleasure/",
      other = "workbox-precache-v2-https://example.test/curiveo/";
    const w = await boot([own, other, "musicpleasure-v2-old"]);
    let job: Promise<unknown> | undefined;
    w.hooks.install({ waitUntil: (p: Promise<unknown>) => (job = p) });
    await job;
    expect(w.skipWaiting).toHaveBeenCalledTimes(1);
    w.hooks.activate({ waitUntil: (p: Promise<unknown>) => (job = p) });
    await job;
    expect(w.removed).toContain(own);
    expect(w.removed).toContain("musicpleasure-v2-old");
    expect(w.removed).not.toContain(other);
    expect(w.claim).toHaveBeenCalledTimes(1);
  });
  it("keeps normal v2 updates waiting for the update button", async () => {
    const w = await boot(["musicpleasure-v2-current"]);
    let job: Promise<unknown> | undefined;
    w.hooks.install({ waitUntil: (p: Promise<unknown>) => (job = p) });
    await job;
    expect(w.skipWaiting).not.toHaveBeenCalled();
    w.hooks.message({ data: { type: "SKIP_WAITING" } });
    expect(w.skipWaiting).toHaveBeenCalledTimes(1);
  });
  it("serves the cached v2 shell when offline", async () => {
    const w = await boot([]);
    let response: Promise<Response> | undefined;
    w.hooks.fetch({
      request: {
        method: "GET",
        url: "https://example.test/musicpleasure/",
        mode: "navigate",
      },
      respondWith: (p: Promise<Response>) => (response = p),
    });
    expect(await (await response!).text()).toBe("offline v2");
    expect(w.caches.match).toHaveBeenCalledWith("./index.html");
  });
});
it("serves precached assets offline even when the server varies responses by Origin", async () => {
 const w=await boot([]);
 w.caches.match.mockImplementation(async (_request: unknown, options?: {ignoreVary:boolean}) => options?.ignoreVary ? new Response("cached JavaScript") : undefined as any);
 let response:Promise<Response>|undefined;
 w.hooks.fetch({request:{method:"GET",url:"https://example.test/musicpleasure/assets/app.js",mode:"cors"},respondWith:(p:Promise<Response>)=>response=p});
 expect(await(await response!).text()).toBe("cached JavaScript");
});
