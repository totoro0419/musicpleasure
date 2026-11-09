import { readdir, writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const files = await readdir("dist/assets");
const version = createHash("sha256")
  .update(await readFile("dist/index.html"))
  .digest("hex")
  .slice(0, 12);
const assets = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./icon.svg",
  ...files.map((f) => "./assets/" + f),
];
await writeFile(
  "dist/sw.js",
  `const CACHE='musicpleasure-v2-${version}';const ASSETS=${JSON.stringify(assets)};const legacy=k=>k.startsWith('workbox-precache-')&&k.includes(self.registration.scope);self.addEventListener('install',e=>e.waitUntil((async()=>{const keys=await caches.keys();await(await caches.open(CACHE)).addAll(ASSETS.map(a=>new Request(new URL(a,self.registration.scope),{cache:'reload'})));if(keys.some(legacy)||!self.registration.active)await self.skipWaiting();})()));self.addEventListener('message',e=>{if(e.data==='SKIP_WAITING'||e.data?.type==='SKIP_WAITING')self.skipWaiting();});self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>(k.startsWith('musicpleasure-')||legacy(k))&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));self.addEventListener('fetch',e=>{if(e.request.method!=='GET'||new URL(e.request.url).origin!==self.location.origin)return;if(e.request.mode==='navigate'){e.respondWith(fetch(e.request,{cache:'no-cache'}).catch(()=>caches.match('./index.html')));return;}e.respondWith(caches.match(e.request).then(c=>c||fetch(e.request)));});`,
);
console.log("Service worker built:", version);
