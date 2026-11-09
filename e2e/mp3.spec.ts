import {test,expect,type Page} from '@playwright/test';
import {execFileSync} from 'node:child_process';
const audio=execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=440:duration=25','-f','mp3','pipe:1']);
const tracks=['M7lc1UVf-VE','abcdefghijk','12345678901'].map((id,i)=>({id:'yt:'+id,title:`MP3 fixture ${i+1}`,artist:'Transport fixture',duration:25,thumbnail:'',sources:[{id:'youtube:'+id,provider:'youtube',videoId:id,url:'https://www.youtube.com/watch?v='+id,kind:'audio',evidence:'fixture',official:false}]}));
async function transport(page:Page, gate?:()=>Promise<void>, fail=false){
  const created:string[]=[];const forbidden:string[]=[];
  page.on('request',r=>{if(/youtube.*(iframe_api|\/embed\/)/.test(r.url()))forbidden.push(r.url());});
  await page.route('**/api/health',r=>r.fulfill({json:{status:'ok',ffmpeg:true,downloader:true,authentication:true}}));
  await page.route('**/api/session',r=>r.fulfill({json:{token:'fixture-session',credential:'device-fixture',expiresAt:Date.now()+900000}}));
  await page.route('**/api/search?**',r=>r.fulfill({json:{items:tracks,nextPageToken:'',provider:'fixture'}}));
  await page.route('**/api/jobs',async r=>{
    if(r.request().method()==='POST'){
      const id=r.request().postDataJSON().videoId;created.push(id);
      if(id===tracks[0].sources[0].videoId && gate)await gate();
      await r.fulfill({status:202,json:{id,videoId:id,state:fail?'failed':'ready',error:fail?'検証用取得失敗':undefined,progress:100,attempt:1,bytes:audio.length}});
    }else await r.fulfill({json:[]});
  });
  await page.route('**/api/assets/*',r=>r.fulfill({contentType:'audio/mpeg',body:audio}));
  return {created,forbidden};
}
async function search(page:Page){
  await page.goto('/#search');
  const input=page.getByLabel('曲・アーティスト・YouTube URLを検索',{exact:true});
  await input.fill('MP3 fixtures');
  await input.press('Enter');
  await expect(input).toHaveValue('MP3 fixtures');
  await expect(page.getByRole('button',{name:'MP3 fixture 1を再生',exact:true})).toBeVisible();
}
async function playing(page:Page){await expect.poll(()=>page.locator('audio').evaluate((a:HTMLAudioElement)=>!a.paused && a.currentTime>0)).toBe(true);}
test('one play click automatically downloads and plays; reload reuses persisted audio; no IFrame',async({page,context})=>{
  const {created,forbidden}=await transport(page);await search(page);
  await page.getByRole('button',{name:'MP3 fixture 1を再生',exact:true}).click();await playing(page);
  await expect.poll(()=>created.slice()).toEqual(['M7lc1UVf-VE','abcdefghijk']);
  await expect(page.locator('iframe')).toHaveCount(0);
  await page.getByRole('button',{name:'フルプレーヤーを開く'}).click();
  await page.getByRole('button',{name:'再生・停止',exact:true}).click();
  const seek=page.getByLabel('フルプレーヤーの再生位置',{exact:true});await seek.press('Home');await seek.press('ArrowRight');
  await expect(seek).toHaveValue('0.1');
  await page.getByRole('button',{name:'閉じる',exact:true}).click();
  await page.reload();
  // A normal reload restores metadata, but must not surprise-autoplay.
  await expect.poll(()=>page.locator('audio').evaluate((a:HTMLAudioElement)=>a.paused)).toBe(true);
  await page.getByRole('button',{name:'フルプレーヤーを開く'}).click();
  await context.setOffline(true);
  await page.getByRole('button',{name:'再生・停止',exact:true}).click();await playing(page);
  expect(created).toEqual(['M7lc1UVf-VE','abcdefghijk']);expect(forbidden).toEqual([]);
  await expect(page.locator('iframe')).toHaveCount(0);
  await context.setOffline(false);
});
test('pausing while fetching prevents autoplay; browsing remains usable',async({page})=>{
  let finish!:()=>void;const gate=new Promise<void>(r=>finish=r);
  const {created,forbidden}=await transport(page,()=>gate);await search(page);
  await page.getByRole('button',{name:'MP3 fixture 1を再生',exact:true}).click();
  await expect.poll(()=>created.length).toBe(1);
  await page.getByRole('button',{name:'フルプレーヤーを開く'}).click();
  await page.getByRole('button',{name:'再生・停止',exact:true}).click();finish();
  await expect(page.getByLabel('フルプレーヤーの再生位置',{exact:true})).toBeEnabled();
  await expect.poll(()=>page.locator('audio').evaluate((a:HTMLAudioElement)=>a.paused)).toBe(true);
  await page.getByRole('button',{name:'再生・停止',exact:true}).click();await playing(page);
  expect(forbidden).toEqual([]);
});
test('a superseded download cannot replace the selected song',async({page})=>{
  let finish!:()=>void;const gate=new Promise<void>(r=>finish=r);
  const {created,forbidden}=await transport(page,()=>gate);await search(page);
  await page.getByRole('button',{name:'MP3 fixture 1を再生',exact:true}).click();
  await expect.poll(()=>created.length).toBe(1);
  await page.locator('.track-list').last().getByRole('button',{name:'MP3 fixture 2を再生',exact:true}).click();await playing(page);
  const src=await page.locator('audio').getAttribute('src');finish();
  await expect.poll(()=>created.length).toBe(3);await page.waitForTimeout(300);
  expect(await page.locator('audio').getAttribute('src')).toBe(src);
  expect(forbidden).toEqual([]);await expect(page.locator('iframe')).toHaveCount(0);
});
test('failed preparation is actionable and never creates a fallback player',async({page})=>{
  const {forbidden}=await transport(page,undefined,true);await search(page);
  await page.getByRole('button',{name:'MP3 fixture 1を再生',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('検証用取得失敗');
  await expect(page.getByRole('button',{name:'再試行',exact:true})).toBeVisible();
  await expect(page.locator('audio')).not.toHaveAttribute('src',/^blob:/);
  expect(forbidden).toEqual([]);await expect(page.locator('iframe')).toHaveCount(0);
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);expect(overflow).toBe(false);
});
