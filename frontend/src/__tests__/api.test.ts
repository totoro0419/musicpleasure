import 'fake-indexeddb/auto';
import { afterEach, beforeEach, it, expect, vi } from 'vitest';
import { useStore } from '../store';
import { api, fetchAudio } from '../api';
import { db } from '../db';
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
beforeEach(async()=>{
  await db.credentials.clear();
  useStore.setState({loaded:false,settings:{...useStore.getState().settings,apiUrl:'',token:''}});
  vi.stubGlobal('location',{hostname:'totoro0419.github.io'});
});
afterEach(()=>vi.unstubAllGlobals());
it('uses public search without forwarding a diagnostic private token; an unconfigured converter fails explicitly',async()=>{
  useStore.getState().settingsUpdate({token:'private-token'});
  const fetch=vi.fn().mockImplementation(async(url:string)=>url.endsWith('runtime.json')?json({apiUrl:''}):json({items:[]}));
  vi.stubGlobal('fetch',fetch);
  await api('/search?q=Song');
  const search=fetch.mock.calls.find(c=>c[0].includes('/api/search'))!;
  expect(search[0]).toBe('https://musicpleasure-search-ibuki.ibukioike2009.chatgpt.site/api/search?q=Song');
  expect(search[1].headers.Authorization).toBeUndefined();
  await expect(api('/jobs',{method:'POST'})).rejects.toThrow('公開設定が完了していません');
});
it('preserves an explicitly configured diagnostic backend and credentials',async()=>{
  useStore.getState().settingsUpdate({apiUrl:'https://diagnostics.example',token:'private-token'});
  const fetch=vi.fn().mockImplementation(async()=>json({}));vi.stubGlobal('fetch',fetch);
  await api('/jobs');
  expect(fetch.mock.calls[0][0]).toBe('https://diagnostics.example/api/jobs');
  expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer private-token');
});
it('automatically authenticates once, shares enrollment, and uses the same backend for jobs and audio',async()=>{
  useStore.getState().settingsUpdate({apiUrl:'https://audio.example'});
  const fetch=vi.fn().mockImplementation(async(url:string)=>{
    if(url.endsWith('/session'))return json({token:'device-token',credential:'device-refresh',expiresAt:Date.now()+900000});
    if(url.includes('/assets/'))return new Response('ID3test',{headers:{'Content-Type':'audio/mpeg'}});
    return json([]);
  });vi.stubGlobal('fetch',fetch);
  await Promise.all([api('/jobs'),api('/storage')]);
  const blob=await fetchAudio('job1');expect(blob.size).toBeGreaterThan(0);
  expect(fetch.mock.calls.filter(c=>c[0].endsWith('/session'))).toHaveLength(1);
  const asset=fetch.mock.calls.find(c=>c[0].includes('/assets/'))!;
  expect(asset[0]).toBe('https://audio.example/api/assets/job1');
  expect(asset[1].headers.Authorization).toBe('Bearer device-token');
  expect((await db.credentials.get('https://audio.example'))?.credential).toBe('device-refresh');
});
it('renews an expired bearer session without a user token prompt',async()=>{
  useStore.getState().settingsUpdate({apiUrl:'https://renew.example'});
  let calls=0;let sessions=0;
  const fetch=vi.fn().mockImplementation(async(url:string)=>{
    if(url.endsWith('/session'))return json({token:`device-${++sessions}`,credential:'refresh',expiresAt:Date.now()+900000});
    return ++calls===1?json({detail:'expired'},401):json([]);
  });vi.stubGlobal('fetch',fetch);
  await api('/jobs');expect(sessions).toBe(2);expect(calls).toBe(2);
  expect(JSON.parse(fetch.mock.calls.filter(c=>c[0].endsWith('/session'))[1][1].body).credential).toBe('refresh');
});
