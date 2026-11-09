import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';
import { db } from '../db';
import { useStore } from '../store';
import type { Track, DownloadJob } from '../types';
import { storeAudio, cachedAudio } from '../cache';
const mocks = vi.hoisted(() => ({createJob:vi.fn(), jobs:vi.fn(), fetchAudio:vi.fn()}));
vi.mock('../api', () => mocks);
const handlers = new Map<string, () => void>();
class FakeAudio extends EventTarget {
  private value = '';
  get src() { return this.value; }
  set src(value:string) { this.value=value; queueMicrotask(() => { if(this.value===value) this.onloadedmetadata?.(); }); }
  preload=''; hidden=false; dataset={}; volume=1; paused=true;
  currentTime=0; duration=8; playCalls=0;
  onloadedmetadata:(() => void)|null=null;
  play=vi.fn(async () => { this.playCalls++; this.paused=false; this.dispatchEvent(new Event('playing')); });
  pause() { this.paused=true; this.dispatchEvent(new Event('pause')); }
  removeAttribute(name:string) { if(name==='src') this.value=''; }
  load() {}
}
const mp3 = new Blob([readFileSync(new URL('../../../backend/tests/fixtures/tone.mp3', import.meta.url))], {type:'audio/mpeg'});
const track:Track = {id:'yt:first',title:'First',artist:'Artist',duration:8,thumbnail:'',sources:[{id:'youtube:M7lc1UVf-VE',provider:'youtube',videoId:'M7lc1UVf-VE',url:'',kind:'audio',official:false,evidence:'fixture'}]};
const second:Track = {...track,id:'yt:second',title:'Second',sources:[{...track.sources[0],id:'youtube:abcdefghijk',videoId:'abcdefghijk'}]};
const ready = (videoId:string):DownloadJob => ({id:videoId,videoId,state:'ready',progress:100,attempt:1,bytes:mp3.size});
let player:typeof import('../player');
const nav = {onLine:true,connection:{saveData:true,effectiveType:'4g'},mediaSession:{playbackState:'none',setActionHandler(a:string,h:()=>void){handlers.set(a,h);}}};
function deferred<T>() { let resolve!:(value:T)=>void; const promise=new Promise<T>(r=>resolve=r); return {promise,resolve}; }
beforeAll(async () => {
  vi.stubGlobal('Audio',FakeAudio);
  vi.stubGlobal('document',{body:{append(){}}});
  vi.stubGlobal('navigator',nav);
  vi.stubGlobal('MediaMetadata',class {});
  player=await import('../player');
});
beforeEach(async () => {
  player.clearPlayback();
  vi.clearAllMocks();
  await db.assets.clear();
  nav.onLine=true; nav.connection.saveData=true;
  (player.audio as unknown as FakeAudio).playCalls=0;
  useStore.setState({loaded:false,tracks:{},artists:{},albums:{},playlists:[],favorites:[],queue:[],currentId:null,position:0,history:[],past:[],future:[],settings:{...useStore.getState().settings,repeat:'none',shuffle:false}});
  mocks.createJob.mockImplementation(async (id:string)=>ready(id));
  mocks.fetchAudio.mockResolvedValue(mp3);
});
describe('automatic MP3 playback', () => {
  it('automatically downloads, persists and plays without a save command', async () => {
    await player.playTracks([track]);
    expect(mocks.createJob).toHaveBeenCalledExactlyOnceWith('M7lc1UVf-VE');
    expect(player.usePlayback.getState()).toMatchObject({engine:'audio',status:'playing',ready:true});
    expect((await db.assets.get(track.sources[0].id))?.sha256).toHaveLength(64);
    expect(useStore.getState().history).toHaveLength(1);
  });
  it('uses saved audio without any API call even offline and after reopening the database', async () => {
    await storeAudio(track.sources[0].id,mp3);
    db.close(); await db.open(); nav.onLine=false;
    await player.playTracks([track]);
    expect(mocks.createJob).not.toHaveBeenCalled();
    expect(mocks.fetchAudio).not.toHaveBeenCalled();
    expect(player.usePlayback.getState().status).toBe('playing');
  });
  it('shares one in-flight job by video ID across different source IDs', async () => {
    const gate=deferred<DownloadJob>(); mocks.createJob.mockReturnValue(gate.promise);
    const a=player.ensureAudio(track);
    const b=player.ensureAudio({...track,id:'alias',sources:[{...track.sources[0],id:'old-source-id'}]});
    expect(a).toBe(b);
    await vi.waitFor(()=>expect(mocks.createJob).toHaveBeenCalledTimes(1));
    gate.resolve(ready('M7lc1UVf-VE')); await Promise.all([a,b]);
    expect(mocks.fetchAudio).toHaveBeenCalledTimes(1);
  });
  it('polls actual queued/downloading/converting states before saving or playing', async () => {
    mocks.createJob.mockResolvedValue({...ready('M7lc1UVf-VE'),state:'queued',progress:null});
    mocks.jobs.mockResolvedValueOnce([{...ready('M7lc1UVf-VE'),state:'converting',progress:null}]).mockResolvedValue([ready('M7lc1UVf-VE')]);
    const task=player.playTracks([track]);
    await vi.waitFor(()=>expect(player.usePlayback.getState().status).toBe('loading'));
    expect(mocks.fetchAudio).not.toHaveBeenCalled();
    expect((player.audio as unknown as FakeAudio).playCalls).toBe(0);
    await task;
    expect(mocks.jobs).toHaveBeenCalledTimes(2);
    expect(player.usePlayback.getState().status).toBe('playing');
  });
  it('never autoplays a superseded request after switching tracks', async () => {
    const gate=deferred<DownloadJob>();
    mocks.createJob.mockImplementation((id:string)=>id==='M7lc1UVf-VE'?gate.promise:Promise.resolve(ready(id)));
    const old=player.playTracks([track,second]);
    await vi.waitFor(()=>expect(mocks.createJob).toHaveBeenCalledTimes(1));
    await player.next();
    const src=player.audio.src;
    gate.resolve(ready('M7lc1UVf-VE')); await old;
    expect(player.audio.src).toBe(src);
    expect(useStore.getState().history.map(h=>h.trackId)).toEqual([second.id]);
  });
  it('pause while downloading preserves pause intent after completion', async () => {
    const gate=deferred<DownloadJob>(); mocks.createJob.mockReturnValue(gate.promise);
    const task=player.playTracks([track]);
    await vi.waitFor(()=>expect(mocks.createJob).toHaveBeenCalledTimes(1));
    await player.togglePlayback(); gate.resolve(ready('M7lc1UVf-VE')); await task;
    expect(player.audio.paused).toBe(true);
    expect(player.usePlayback.getState().status).toBe('paused');
    expect(useStore.getState().history).toHaveLength(0);
    await player.togglePlayback(); expect(player.usePlayback.getState().status).toBe('playing');
    expect(mocks.createJob).toHaveBeenCalledTimes(1);
  });
  it('media pause cancels pending autoplay and media play is idempotent', async () => {
    const gate=deferred<DownloadJob>(); mocks.createJob.mockReturnValue(gate.promise);
    const task=player.playTracks([track]); handlers.get('pause')!();
    gate.resolve(ready('M7lc1UVf-VE')); await task;
    expect(player.audio.paused).toBe(true);
    handlers.get('play')!(); await vi.waitFor(()=>expect(player.audio.paused).toBe(false));
    handlers.get('play')!(); expect((player.audio as unknown as FakeAudio).playCalls).toBe(1);
  });
  it('prefetches only the next track and reuses it when advancing', async () => {
    nav.connection.saveData=false;
    const third={...second,id:'third',sources:[{...second.sources[0],id:'youtube:12345678901',videoId:'12345678901'}]};
    await player.playTracks([track,second,third]);
    await vi.waitFor(async()=>expect(await db.assets.get(second.sources[0].id)).toBeDefined());
    expect(mocks.createJob.mock.calls.map(c=>c[0])).toEqual(['M7lc1UVf-VE','abcdefghijk']);
    nav.connection.saveData=true;
    await player.next();
    expect(mocks.createJob).toHaveBeenCalledTimes(2);
  });
  it('reports failure without any playback fallback and allows retry', async () => {
    mocks.createJob.mockResolvedValueOnce({...ready('M7lc1UVf-VE'),state:'failed',error:'取得できません'});
    await player.playTracks([track]);
    expect(player.usePlayback.getState()).toMatchObject({status:'error',engine:null,error:'取得できません'});
    expect(player.audio.src).toBe(''); expect(useStore.getState().history).toHaveLength(0);
    await player.togglePlayback(); expect(player.usePlayback.getState().status).toBe('playing');
  });
  it('detects cache corruption, discards it, and re-downloads the requested track', async () => {
    await storeAudio(track.sources[0].id,mp3);
    await db.assets.update(track.sources[0].id,{sha256:'invalid'});
    await player.playTracks([track]); expect(mocks.createJob).toHaveBeenCalledTimes(1);
    expect(await cachedAudio(track)).toBeDefined();
  });
  it('rejects an invalid server payload without storing or claiming playback', async () => {
    mocks.fetchAudio.mockResolvedValueOnce(new Blob(['not audio']));
    await player.playTracks([track]);
    expect(player.usePlayback.getState().status).toBe('error');
    expect(await db.assets.count()).toBe(0);
  });
  it('does not pretend autoplay succeeded when the browser denies play()', async () => {
    const audio=player.audio as unknown as FakeAudio;
    audio.play.mockRejectedValueOnce(new DOMException('Autoplay denied','NotAllowedError'));
    await player.playTracks([track]);
    expect(player.usePlayback.getState().status).toBe('error');
    expect(useStore.getState().history).toHaveLength(0);
    await player.togglePlayback(); expect(player.usePlayback.getState().status).toBe('playing');
  });
  it('restores seek position and supports repeat, volume and playlist isolation', async () => {
    const id=useStore.getState().createPlaylist('Saved',[track,second]);
    const entries=structuredClone(useStore.getState().playlists[0].entries);
    useStore.getState().play([track,second]); useStore.setState({position:3});
    await player.startCurrent(false); expect(player.audio.currentTime).toBe(3);
    player.seek(5); expect(useStore.getState().position).toBe(5);
    useStore.getState().settingsUpdate({volume:.35,repeat:'one'});
    expect(player.audio.volume).toBe(.35);
    await player.next(true); expect(player.audio.currentTime).toBe(0);
    useStore.getState().settingsUpdate({repeat:'none'}); await player.next();
    expect(useStore.getState().playlists.find(p=>p.id===id)?.entries).toEqual(entries);
  });
  it('does not download when a playlist is merely created or edited', () => {
    useStore.getState().createPlaylist('Playlist',[track,second]);
    expect(mocks.createJob).not.toHaveBeenCalled();
  });
  it('retains shared MP3 when one playlist is deleted', async () => {
    await storeAudio(track.sources[0].id,mp3);
    const first=useStore.getState().createPlaylist('One',[track]);
    useStore.getState().createPlaylist('Two',[track]); useStore.getState().deletePlaylist(first);
    expect(await cachedAudio(track)).toBeDefined();
  });
});
it('stop during preparation cancels intent and resets the position without clearing the queue',async()=>{
  const gate=deferred<DownloadJob>();mocks.createJob.mockReturnValue(gate.promise);
  const task=player.playTracks([track]);
  await vi.waitFor(()=>expect(mocks.createJob).toHaveBeenCalledTimes(1));
  player.stopPlayback();gate.resolve(ready('M7lc1UVf-VE'));await task;
  expect(player.audio.src).toBe('');expect(player.audio.paused).toBe(true);
  expect(useStore.getState().queue).toHaveLength(1);expect(useStore.getState().position).toBe(0);
});
it('limits actual downloads to two in flight even for explicit bulk requests',async()=>{
  const one=deferred<DownloadJob>(),two=deferred<DownloadJob>();
  mocks.createJob.mockImplementation((id:string)=>id==='M7lc1UVf-VE'?one.promise:id==='abcdefghijk'?two.promise:Promise.resolve(ready(id)));
  const third={...second,id:'third',sources:[{...second.sources[0],id:'youtube:12345678901',videoId:'12345678901'}]};
  const bulk=player.saveTracks([track,second,third]);
  await vi.waitFor(()=>expect(mocks.createJob).toHaveBeenCalledTimes(2));
  one.resolve(ready('M7lc1UVf-VE'));
  await vi.waitFor(()=>expect(mocks.createJob).toHaveBeenCalledTimes(3));
  two.resolve(ready('abcdefghijk'));await bulk;
  expect(await db.assets.count()).toBe(3);
});
