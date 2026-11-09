import { useStore } from './store';
import { db } from './db';
import type { Track, DownloadJob, Proposal } from './types';
const PUBLIC_SEARCH_API = 'https://musicpleasure-search-ibuki.ibukioike2009.chatgpt.site';
let deployedApi: string | undefined;
let configTask: Promise<void> | undefined;
export function base() {
  return (useStore.getState().settings.apiUrl || deployedApi || import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
}
async function configuration() {
  if (!configTask) configTask = (async () => {
    if (useStore.getState().settings.apiUrl || import.meta.env.VITE_API_URL) return;
    try {
      const r = await fetch(`${import.meta.env.BASE_URL}runtime.json`, {cache:'no-store', signal:AbortSignal.timeout(5000)});
      if (!r.ok) return;
      const value = await r.json();
      if (value.apiUrl && new URL(value.apiUrl).protocol === 'https:') deployedApi = value.apiUrl.replace(/\/$/, '');
    } catch { /* Offline cached playback never calls this path. */ }
  })();
  await configTask;
}
function hosted() {
  const host = globalThis.location?.hostname || '';
  return host === 'totoro0419.github.io' || host.endsWith('.chatgpt.site');
}
async function endpoint(path: string) {
  await configuration();
  const configured = base();
  if (configured || !hosted()) return configured;
  if (/^\/(health|search|parse-url|playlists)(?:[/?]|$)/.test(path)) return PUBLIC_SEARCH_API;
  throw new Error('音源サーバーの公開設定が完了していません。保存済みMP3は再生できます');
}
const sessions = new Map<string, {token:string; expiresAt:number}>();
const authenticating = new Map<string, Promise<string>>();
async function authorization(origin: string) {
  const settings = useStore.getState().settings;
  if (settings.token && settings.apiUrl === origin) return settings.token; // diagnostics only
  const active = sessions.get(origin);
  if (active && active.expiresAt > Date.now() + 30000) return active.token;
  if (authenticating.has(origin)) return authenticating.get(origin)!;
  const task = (async () => {
    const saved = await db.credentials.get(origin || 'same-origin');
    const enroll = (credential:string) => fetch(origin + '/api/session', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({credential}),signal:AbortSignal.timeout(15000)});
    let r = await enroll(saved?.credential || '');
    // A server restored without its old device table can enroll this public-app
    // device again; rate limits still apply before authentication.
    if (r.status === 401 && saved?.credential) {
      await db.credentials.delete(origin || 'same-origin');
      r = await enroll('');
    }
    if (!r.ok) throw new Error('音源サーバーに認証できませんでした。再試行してください');
    const value = await r.json();
    if (!value.token || !value.credential || !Number.isFinite(value.expiresAt)) throw new Error('認証サーバーの応答が不正です');
    await db.credentials.put({id:origin || 'same-origin',credential:value.credential});
    sessions.set(origin,value);
    return value.token as string;
  })().finally(() => authenticating.delete(origin));
  authenticating.set(origin,task);
  return task;
}
async function request(path:string, options:RequestInit={}, retried=false):Promise<Response> {
  const origin = await endpoint(path);
  const publicSearch = origin === PUBLIC_SEARCH_API;
  const token = publicSearch || path === '/health' ? '' : await authorization(origin);
  let r: Response;
  try {
    r = await fetch(origin + '/api' + path, {...options,headers:{'Content-Type':'application/json',...(token ? {Authorization:`Bearer ${token}`} : {}),...options.headers},signal:options.signal || AbortSignal.timeout(path.startsWith('/assets/') ? 120000 : 65000)});
  } catch (e) {
    if (options.signal?.aborted) throw e;
    throw new Error(navigator.onLine === false ? 'オフラインです。保存済みMP3を選んでください' : 'サーバーに接続できませんでした。通信を確認して再試行してください');
  }
  if (r.status === 401 && !retried && !publicSearch && !useStore.getState().settings.token) {
    sessions.delete(origin);
    return request(path,options,true);
  }
  if (!r.ok) {
    let msg = `接続エラー (${r.status})。再試行してください`;
    try { const value=await r.json(); if(typeof value.detail==='string') msg=value.detail; } catch { /* keep status */ }
    throw new Error(msg);
  }
  return r;
}
export async function api<T>(path:string,options:RequestInit={}):Promise<T> {
  const r = await request(path,options);
  if (!r.headers.get('Content-Type')?.includes('json')) throw new Error('サーバーから有効な応答がありません');
  return r.json();
}
export const search = (q:string,page='',kind='all',signal?:AbortSignal) => api<{items:Track[];nextPageToken:string;provider:string}>(`/search?${new URLSearchParams({q,page,kind})}`,{signal});
export const jobs = () => api<DownloadJob[]>('/jobs');
export const createJob = (videoId:string) => api<DownloadJob>('/jobs',{method:'POST',body:JSON.stringify({videoId})});
export const assistant = (prompt:string,tracks:Track[]) => api<Proposal>('/assistant',{method:'POST',body:JSON.stringify({prompt,tracks})});
export async function fetchAudio(id:string) {
  const r = await request(`/assets/${encodeURIComponent(id)}`);
  const blob = await r.blob();
  if (!blob.size || !r.headers.get('content-type')?.includes('audio/')) throw new Error('有効な音声ファイルが返されませんでした');
  return blob;
}
