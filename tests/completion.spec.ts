import { test, expect } from "@playwright/test";
import { tone } from "./audio-fixtures";
import { emptyData, newPlaylist, placeholder } from "../src/lib/model";
test("automatic multi-page playlist preview and Japanese changes are usable from the screen",async({page})=>{
 const id=(i:number)=>"T"+String(i).padStart(10,"0");
 await page.route("https://**/api/v1/playlists/**",async r=>{
  const n=Number(new URL(r.request().url()).searchParams.get("page"));
  const item=(i:number)=>({videoId:id(i),title:`Song ${i}`,author:"Singer",lengthSeconds:180,index:i});
  const videos=n===1?Array.from({length:100},(_,i)=>i===5?{title:"[Private video]",index:5}:item(i)): [item(99),item(100)];
  await r.fulfill({headers:{"access-control-allow-origin":"*"},json:{title:"Automatic Import",videoCount:102,videos}});
 });
 await page.goto("./#import");await page.getByLabel("プレイリストURL",{exact:true}).fill("https://youtube.com/playlist?list=PLfixture");
 await page.getByRole("button",{name:"全ページを自動取得",exact:true}).click();
 await expect(page.getByText(/全ページ取得完了/)).toBeVisible();
 await expect(page.getByText("[Private video]：非公開",{exact:true})).toBeVisible();
 await page.getByRole("button",{name:"この100曲を取り込む",exact:true}).click();
 await page.reload();await expect(page.getByText(/全ページ取得完了/)).toBeVisible();
 await page.goto("./#library");
 await page.locator(".playlist-card").getByText("Automatic Import",{exact:true}).click();
 await page.getByRole("button",{name:"まとめて編集",exact:true}).click();
 await page.getByLabel("操作内容").fill("名前を「Night」に変更して");await page.getByRole("button",{name:"変更をプレビュー",exact:true}).click();
 await expect(page.getByText(/「Automatic Import」の名前を「Night」へ変更/)).toBeVisible();await page.getByRole("button",{name:"この変更を実行",exact:true}).click();
 await page.getByRole("button",{name:"元に戻す",exact:true}).click();await expect(page.getByRole("heading",{name:"Automatic Import",exact:true})).toBeVisible();
 await page.getByRole("button",{name:"やり直す",exact:true}).click();await expect(page.getByRole("heading",{name:"Night",exact:true})).toBeVisible();
 await page.getByLabel("操作内容").fill("適当に削除して");await page.getByRole("button",{name:"変更をプレビュー",exact:true}).click();
 await expect(page.getByText(/対象を特定できません/)).toBeVisible();await expect(page.getByRole("button",{name:"この変更を実行",exact:true})).toHaveCount(0);
});

test("prepared audio buffers are reused and actual starts are timed with prefetch enabled/disabled",async({page},info)=>{
 test.setTimeout(90000);
 const ids=["AAAAAAA0000","AAAAAAA0001","AAAAAAA0002","AAAAAAA0003"];
 const requests: Record<string, number> = {};
 const requestedAt: Record<string, number> = {};
 const media = tone(0, 20).buffer;
 await page.route("https://**/*",async r=>{
  const u=new URL(r.request().url());
  if(u.hostname==="audio.fixture.test")return r.fulfill({headers:{"access-control-allow-origin":"*"},contentType:"audio/wav",body:media});
  if(u.pathname.startsWith("/api/v1/videos/")) {
   const id = u.pathname.split("/").at(-1)!;
   requests[id] = (requests[id] || 0) + 1;
   requestedAt[id] ??= Date.now();
   await new Promise(resolve=>setTimeout(resolve,500));
   return r.fulfill({headers:{"access-control-allow-origin":"*"},json:{videoId:id,title:id,author:"Fixture",lengthSeconds:20,adaptiveFormats:[{url:`https://audio.fixture.test/${id}.wav`,type:"audio/wav",bitrate:352800}]}});
  }
  if(u.pathname.startsWith("/api/v1/"))return r.fulfill({headers:{"access-control-allow-origin":"*"},json:[]});
  return r.continue();
 });
 const comparisons:any[]=[];
 for(const prefetch of [false,true]) {
  const selected=prefetch?ids.slice(2):ids.slice(0,2);const d=emptyData();d.settings.prefetch=prefetch;
  selected.forEach(id=>d.tracks[id]={...placeholder(id),duration:20});d.queue=selected;d.current=0;
  await page.goto("./#settings");await page.locator("input[type=file]").setInputFiles({name:"prefetch.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(d))});await page.getByRole("button",{name:"確認して復元",exact:true}).click();
  await page.locator(".play-toggle").click();await expect(page.locator(".mini-track")).toContainText("再生中");
  const read=async()=>JSON.parse((await page.getByTestId("playback-diagnostics").textContent())||"{}");
  if(prefetch)await expect.poll(async()=>(await read()).events.some((e:any)=>e.trackId===selected[1]&&e.stage==="probe"&&e.outcome==="success")).toBe(true);
  const before=requests[selected[1]]||0;
  await page.getByRole("button",{name:"次の曲",exact:true}).click();
  await expect.poll(async()=>(await read()).starts.some((s:any)=>s.id===selected[1])).toBe(true);
  const row=(await read()).starts.find((s:any)=>s.id===selected[1]);expect(row.prefetched).toBe(prefetch);
  if(prefetch)expect(requests[selected[1]]).toBe(before);
  const prepared = (await read()).events.find((event: { trackId: string; stage: string; outcome: string }) =>
   event.trackId === selected[1] && event.stage === "probe" && event.outcome === "success",
  );
  comparisons.push({
   ...row,
   prepareMs: prepared.at - requestedAt[selected[1]],
   apiRequests: requests[selected[1]],
   switchRequests: (requests[selected[1]] || 0) - before,
   controlledFixture: true,
  });
 }
 console.log("PREFETCH_COMPARISON", JSON.stringify({ project: info.project.name, comparisons }));
 await info.attach("prefetch-start-comparison",{body:JSON.stringify(comparisons,null,2),contentType:"application/json"});
});

test("authorized HTTPS audio download requires consent and preserves the library on a network failure", async ({ page }) => {
  await page.route("https://owned-audio.fixture.test/**", (route) => {
    if (route.request().url().includes("failure")) {
      return route.abort("failed");
    }
    return route.fulfill({
      headers: { "access-control-allow-origin": "*" },
      contentType: "audio/wav",
      body: tone(7).buffer,
    });
  });

  await page.goto("./#local");
  await page.getByText("保存が許可されたHTTPS音源から取り込む", { exact: true }).click();
  const source = page.getByLabel("音声ファイルURL", { exact: true });
  const save = page.getByRole("button", { name: "許可された音源を保存", exact: true });
  await source.fill("https://owned-audio.fixture.test/permitted.wav");
  await expect(save).toBeDisabled();
  await page.getByRole("checkbox", {
    name: "この音源のダウンロード・オフライン利用が許可されています",
    exact: true,
  }).check();
  await save.click();
  await expect(page.locator(".trackrow")).toHaveCount(1);
  await expect(save).toBeEnabled();

  await source.fill("https://owned-audio.fixture.test/failure.wav");
  await save.click();
  await expect(page.getByText(/取得失敗：/)).toBeVisible();
  await expect(page.locator(".trackrow")).toHaveCount(1);
});
