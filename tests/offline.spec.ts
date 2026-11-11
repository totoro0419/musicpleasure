import { test, expect, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { tone } from "./audio-fixtures";
import { emptyData, newPlaylist, placeholder } from "../src/lib/model";
async function advances(page: Page) {
 const seek=page.getByLabel("再生位置",{exact:true});
 let previous=Number(await seek.inputValue());let progress=0;
 await expect.poll(async()=>{const p=Number(await seek.inputValue());const delta=p-previous;previous=p;if(delta>0&&delta<2.5)progress+=delta;return progress;},{timeout:5000,intervals:[200,300]}).toBeGreaterThan(0.5);
}
test("offline saved audio survives reload and plays three distinct files through genuine ended events",async({page,context},info)=>{
 test.setTimeout(100000);
 const files=[tone(0),tone(1),tone(2)];
 const ids=files.map(f=>"local-"+createHash("sha256").update(f.buffer).digest("hex"));
 await page.goto("./#local");
 await page.getByLabel("取り込む音声ファイル").setInputFiles(files);
 await expect(page.locator(".trackrow")).toHaveCount(3);
 await expect(page.getByText("TestArtist - Offline 3.wav：保存しました",{exact:true})).toBeVisible();
 await page.getByLabel("取り込む音声ファイル").setInputFiles([files[0]]);
 await expect(page.getByText(/保存済み（重複なし）/)).toBeVisible();
 await expect(page.locator(".trackrow")).toHaveCount(3);
 // The app shell must really be installed before disconnecting, not just in-memory React.
 await page.evaluate(async()=>{await navigator.serviceWorker.ready;});
 await page.reload();
 await expect(page.locator(".trackrow")).toHaveCount(3);
 await expect.poll(()=>page.evaluate(()=>!!navigator.serviceWorker.controller)).toBe(true);
 // Import metadata through the normal backup UI; binary files remain in their separate stores.
 const d=emptyData();
 ids.forEach((id,i)=>d.tracks[id]={id,title:`Offline ${i+1}`,uploader:"TestArtist",duration:6,thumbnail:"",source:"local",local:{filename:files[i].name,bytes:files[i].buffer.length,mime:"audio/wav",hash:id.slice(6),added:1,available:true}});
 const online="M7lc1UVf-VE";d.tracks[online]=placeholder(online);
 const playlist=newPlaylist("Offline mixed",[online,...ids]);d.playlists=[playlist];
 await page.goto("./#settings");await page.locator("input[type=file]").setInputFiles({name:"metadata.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(d))});await page.getByRole("button",{name:"確認して復元",exact:true}).click();
 await context.setOffline(true);
 await page.goto("./#local");await page.reload();
 await expect(page.getByText("オフラインです。",{exact:false})).toBeVisible();
 await expect(page.locator(".trackrow")).toHaveCount(3);
 await page.getByLabel("保存曲を検索").fill("Offline 2");await expect(page.locator(".trackrow")).toHaveCount(1);
 await page.getByLabel("保存曲を検索").fill("");
 await page.goto("./#playlist/"+playlist.id);
 const start=Date.now();await page.locator("main").getByRole("button",{name:"再生",exact:true}).click();
 const observed:string[]=[];
 for(let i=0;i<3;i++){
  await expect(page.locator(".mini-track")).toHaveAttribute("data-track-id",ids[i],{timeout:15000});
  await expect(page.locator(".mini-track")).toContainText("再生中");await advances(page);observed.push(ids[i]);
  if(i===0){
   await page.locator(".play-toggle").click();await expect(page.locator(".mini-track")).toContainText("一時停止");
   const paused=await page.getByLabel("再生位置",{exact:true}).inputValue();await page.getByLabel("音量",{exact:true}).press("ArrowLeft");expect(await page.getByLabel("再生位置",{exact:true}).inputValue()).toBe(paused);
   await page.locator(".play-toggle").click();await advances(page);
   await page.getByRole("button",{name:"ミニプレーヤーを閉じる",exact:true}).click();
   await expect(page.getByRole("button",{name:"ミニプレーヤーを再表示",exact:true})).toBeVisible();
   await page.getByRole("button",{name:"ミニプレーヤーを再表示",exact:true}).click();
  }
 }
 expect(new Set(observed).size).toBe(3);
 await page.goto("./#settings");
 const diag=JSON.parse((await page.getByTestId("playback-diagnostics").textContent())||"{}");
 expect(ids.every(id=>diag.starts.some((s:any)=>s.id===id&&s.source==="local"&&s.startMs>0))).toBe(true);
 const evidence = {
  project: info.project.name,
  network: "context.setOffline(true), offline shell reload",
  originalTones: true,
  distinct: observed,
  elapsedMs: Date.now() - start,
  starts: diag.starts,
 };
 console.log("OFFLINE_PLAYBACK", JSON.stringify(evidence));
 await info.attach("offline-actual-playback", {
  body: JSON.stringify(evidence, null, 2),
  contentType: "application/json",
 });
 // Repeat/shuffle/seek operate on the same persisted audio while the network is still disabled.
 await page.goto("./#local");await page.getByRole("button",{name:"保存曲を連続再生",exact:true}).click();await advances(page);
 await page.goto("./#playing");
 await page.locator("main").getByRole("button",{name:"シャッフル OFF",exact:true}).click();
 await page.locator("main").getByRole("button",{name:"リピート なし",exact:true}).click();await page.locator("main").getByRole("button",{name:"リピート 全曲",exact:true}).click();
 const repeated=await page.locator(".mini-track").getAttribute("data-track-id");
 await page.goto("./#settings");
 const beforeRepeat=JSON.parse((await page.getByTestId("playback-diagnostics").textContent())||"{}").starts.filter((s:any)=>s.id===repeated).length;
 await page.getByLabel("再生位置",{exact:true}).press("End");
 await expect.poll(async()=>JSON.parse((await page.getByTestId("playback-diagnostics").textContent())||"{}").starts.filter((s:any)=>s.id===repeated).length,{timeout:10000}).toBeGreaterThan(beforeRepeat);
 await page.goto("./#local");
 await page.getByRole("button",{name:"音源を削除",exact:true}).first().click();await page.getByRole("button",{name:"削除を確定",exact:true}).click();
 await expect(page.getByText(/音声未保存・元ファイルを再取り込み/)).toBeVisible();
 await page.reload();await expect(page.getByText(/音声未保存・元ファイルを再取り込み/)).toBeVisible();
 await page.getByLabel("取り込む音声ファイル").setInputFiles([files[0]]);await expect(page.getByText("TestArtist - Offline 1.wav：保存しました",{exact:true})).toBeVisible();
 await expect(page.locator(".trackrow")).toHaveCount(3);
});

test("local import rejects corrupt and unsupported files without losing saved music",async({page})=>{
 await page.goto("./#local");await page.getByLabel("取り込む音声ファイル").setInputFiles([tone(0)]);await expect(page.locator(".trackrow")).toHaveCount(1);
 await page.getByLabel("取り込む音声ファイル").setInputFiles([{name:"broken.mp3",mimeType:"audio/mpeg",buffer:Buffer.from("not audio")},{name:"document.txt",mimeType:"text/plain",buffer:Buffer.from("not audio")}]);
 await expect(page.getByText(/document.txt：音声ファイルを選択/)).toBeVisible();await expect(page.getByText(/broken.mp3：音声をデコード/)).toBeVisible();await expect(page.locator(".trackrow")).toHaveCount(1);
});
