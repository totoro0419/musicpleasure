import type {AudioStream, InvidiousItem, InstanceHealth, SearchPage, StreamInfo, Track} from "../types";
import {healthRead,healthSave} from "./storage";
import {fromItem} from "./model";
import {PlaybackError,classify,reliability} from "./reliability";

// Official public instances: a user-tested working server first.
const seed=[
  "https://yt.chocolatemoo53.com",
  "https://eu.yt.chocolatemoo53.com",
  "https://invidious.nerdvpn.de",
  "https://inv.nadeko.net",
  "https://invidious.tiekoetter.com",
];
type Raw=Record<string,any>;
const fresh=(url:string):InstanceHealth=>({url,success:0,failure:0,latency:1200,cooldown:0,lastError:"",audioSuccess:0,lastChecked:0});
const image=(raw:unknown,base:string)=>{
  if(!Array.isArray(raw))return "";
  const best=[...raw].sort((a,b)=>(Number(b.width)||0)-(Number(a.width)||0))[0]?.url;
  try {const u=new URL(String(best||""),base);return u.protocol==="https:"?u.href:"";}catch{return "";}
};
export function normalizeItem(raw:Raw,base="https://yt.chocolatemoo53.com"):InvidiousItem{
 const channel=raw.type==="channel";
 const id=String(raw.videoId||"");
 const uploaderUrl=String(raw.authorUrl||(raw.authorId?"/channel/"+raw.authorId:""));
 return {
  type:channel?"channel":"stream",
  url:channel?uploaderUrl:id?"https://www.youtube.com/watch?v="+id:"",
  name:channel?String(raw.author||""):undefined,
  title:channel?String(raw.author||""):String(raw.title||id),
  uploaderName:String(raw.author||""),uploader:String(raw.author||""),uploaderUrl,
  thumbnailUrl:image(channel?raw.authorThumbnails:raw.videoThumbnails,base),
  duration:Number(raw.lengthSeconds)||0,uploadedDate:String(raw.publishedText||""),
  uploaderVerified:!!raw.authorVerified,
 };
}
function normalizeFormat(raw:Raw,base:string):AudioStream{
  let url="";
  try{const u=new URL(String(raw.url||""),base);if(u.protocol==="https:")url=u.href;}catch{}
  const type=String(raw.type||"");
  return {url, itag:/^[0-9]{1,3}$/.test(String(raw.itag||""))?String(raw.itag):undefined,
    mimeType:type.split(";")[0].trim(),
    codec:type.match(/codecs?=["']?([^"';]+)["']?/i)?.[1],
    bitrate:Number(raw.bitrate)||0,quality:String(raw.audioQuality||raw.qualityLabel||raw.quality||"")};
}
export function normalizeVideo(raw:Raw,base:string,id=""):StreamInfo{
 if(!raw || typeof raw!=="object" || !raw.title)
   throw new PlaybackError("invalid_response","Invidiousの動画応答が不正です","streams",base);
 const videoId=String(raw.videoId||id);
 const a=Array.isArray(raw.adaptiveFormats)?raw.adaptiveFormats:[];
 const muxed=Array.isArray(raw.formatStreams)?raw.formatStreams:[];
 return {
  title:String(raw.title),uploader:String(raw.author||""),
  uploaderUrl:String(raw.authorUrl||(raw.authorId?"/channel/"+raw.authorId:"")),
  thumbnailUrl:image(raw.videoThumbnails,base)||"https://i.ytimg.com/vi/"+videoId+"/hqdefault.jpg",
  duration:Number(raw.lengthSeconds)||0,
  audioStreams:a.filter((x:Raw)=>String(x.type||"").startsWith("audio/"))
    .map((x:Raw)=>normalizeFormat(x,base)).filter((s:AudioStream)=>!!s.url),
  videoStreams:muxed.filter((x:Raw)=>String(x.type||"").startsWith("video/mp4"))
    .map((x:Raw)=>({...normalizeFormat(x,base),videoOnly:false}))
    .filter((s:AudioStream)=>!!s.url),
  relatedStreams:(Array.isArray(raw.recommendedVideos)?raw.recommendedVideos:[])
    .map((x:Raw)=>normalizeItem(x,base)),
 };
}
export class InvidiousClient{
 health:InstanceHealth[]=seed.map(fresh);
 preferred="";
 onHealth=()=>{};
 private cache=new Map<string,{at:number;value:unknown}>();
 async init(){
   try{
    const saved=await healthRead();
    if(Array.isArray(saved))this.health=saved.filter(x=>{
      if(typeof x.url!=="string")return false;
      try{const u=new URL(x.url);return u.protocol==="https:"&&
        (seed.includes(u.origin)||/invidious|(^inv\.)|(^yt\.)|chocolatemoo/i.test(u.hostname));}catch{return false;}
    });
   }catch{}
   for(const url of seed)if(!this.health.some(h=>h.url===url))this.health.push(fresh(url));
   this.onHealth();
 }
 add(url:string){
  const u=new URL(url);
  if(u.protocol!=="https:"||u.username||u.password||u.search||u.hash||u.pathname!=="/")
   throw Error("HTTPSのAPIホストを指定してください");
  const clean=u.origin;
  if(!this.health.some(h=>h.url===clean))this.health.push(fresh(clean));
  this.record();return clean;
 }
 ranked(includeCooling=false,capability:"api"|"audio"="api"){
  return [...this.health].filter(h=>includeCooling||(h.cooldown<Date.now()&&
   (capability!=="audio"||(h.audioCooldown||0)<Date.now())))
  .sort((a,b)=>this.score(a,capability)-this.score(b,capability));
 }
 private score(h:InstanceHealth,capability:"api"|"audio"){
  return h.latency+Math.min(15,h.failure)*400-Math.min(20,h.success)*60
   +(capability==="audio"?-4000*((h.audioSuccess+1)/(h.audioSuccess+(h.audioFailure||0)+2))
      +Math.min(3000,(h.audioFailure||0)*150):0)
   -(h.url===this.preferred?5000:0);
 }
 record(){this.onHealth();void healthSave(this.health).catch(()=>{});}
 failure(url:string,error:unknown){
  const h=this.health.find(h=>h.url===url);if(!h)return;
  h.failure++;h.lastError=error instanceof Error?error.message:String(error);
  h.lastChecked=Date.now();h.cooldown=Date.now()+Math.min(300000,10000*2**Math.min(h.failure,5));this.record();
 }
 audioSuccess(url:string){
  const h=this.health.find(h=>h.url===url);if(!h)return;
  h.audioSuccess++;h.lastAudioSuccess=Date.now();h.audioCooldown=0;
  h.lastAudioError="";h.cooldown=0;this.record();
 }
 audioResult(url:string,result:"prepared"|"failure",error?:PlaybackError){
  const h=this.health.find(h=>h.url===url);if(!h)return;
  if(result==="prepared"){h.audioPrepared=(h.audioPrepared||0)+1;h.audioCooldown=0;h.lastAudioError="";}
  else if(error&&!["cancelled","autoplay_blocked","unsupported_format"].includes(error.kind)){
   h.audioFailure=(h.audioFailure||0)+1;h.lastAudioError=error.message;
   if(["network_or_cors","timeout","api_unavailable","invalid_response"].includes(error.kind))
     h.audioCooldown=Date.now()+30000;
  }
  this.record();
 }
 async at<T>(url:string,path:string,signal?:AbortSignal,timeout=4500):Promise<T>{
  const started=performance.now(),video=path.startsWith("/api/v1/videos/");
  try{
   const r=await fetch(url+path,{credentials:"omit",...(video?{cache:"no-store" as RequestCache}:{}),signal:signal?
     AbortSignal.any([signal,AbortSignal.timeout(timeout)]):AbortSignal.timeout(timeout)});
   const raw=await r.text();
   let data:Raw;
   try{data=JSON.parse(raw);}catch{throw new PlaybackError("invalid_response","HTTP "+r.status+": JSON以外の応答",video?"streams":"api",url,r.status);}
   if(!r.ok||data?.error){
    const detail=String(data?.error||data?.message||"HTTP "+r.status);
    throw new PlaybackError(
      /LOGIN_REQUIRED|SignInConfirmNotBot|not a bot/i.test(detail)?"upstream_rejected":
      r.status===404?"no_stream":"api_unavailable",
      "HTTP "+r.status+": "+detail.slice(0,160),
      video?"streams":"api",url,r.status);
   }
   const h=this.health.find(h=>h.url===url);
   if(h){h.success++;h.latency=performance.now()-started;h.lastChecked=Date.now();
    h.cooldown=0;h.lastError="";this.record();}
   return (video?normalizeVideo(data,url,path.split("/")[4]?.split("?")[0]):data) as T;
  }catch(e){
   const err=classify(e,video?"streams":"api",url);
   if(!signal?.aborted){
    if(!["upstream_rejected","no_stream"].includes(err.kind))this.failure(url,err);
    reliability.record({trackId:video?path.split("/")[4]?.split("?")[0]:undefined,instance:url,
      stage:err.stage,outcome:"failure",kind:err.kind,status:err.status,detail:err.message});
   }
   throw err;
  }
 }
 async request<T>(path:string,signal?:AbortSignal,force=false):Promise<T>{
  const cache=this.cache.get(path);
  if(!force&&cache&&Date.now()-cache.at<90000)return cache.value as T;
  const ranked=this.ranked();
  const candidates=[...ranked,...this.ranked(true).filter(h=>!ranked.includes(h))].slice(0,8);
  const limit=AbortSignal.timeout(16000);
  const combined=signal?AbortSignal.any([signal,limit]):limit;
  for(let i=0;i<candidates.length;i+=3){
   if(combined.aborted)break;
   try{
    const value=await Promise.any(candidates.slice(i,i+3).map(h=>this.at<T>(h.url,path,combined,5000)));
    this.cache.set(path,{at:Date.now(),value});
    if(this.cache.size>150)this.cache.delete(this.cache.keys().next().value!);
    return value;
   }catch{if(signal?.aborted)throw signal.reason;}
  }
  throw Error("Invidious APIに接続できません。接続先を再評価してください。");
 }
 async search(q:string,nextpage?:string,signal?:AbortSignal,filter="videos"):Promise<SearchPage>{
  const page=Math.max(1,Number(nextpage)||1);
  const params=new URLSearchParams({q,type:filter==="channels"?"channel":"video",page:String(page)});
  const data=await this.request<Raw[]>("/api/v1/search?"+params,signal);
  if(!Array.isArray(data))throw Error("検索応答の形式が正しくありません");
  return {items:data.map(x=>normalizeItem(x)).filter(x=>!!x.url),nextpage:data.length>=20?String(page+1):null};
 }
 async streams(id:string,signal?:AbortSignal):Promise<StreamInfo>{
  const info=await this.request<StreamInfo>("/api/v1/videos/"+encodeURIComponent(id),signal);
  if(!Array.isArray(info.audioStreams))throw Error("音声情報の形式が不正です");
  return info;
 }
 async suggestions(q:string,signal?:AbortSignal){
  const d=await this.request<Raw>("/api/v1/search/suggestions?q="+encodeURIComponent(q),signal);
  return Array.isArray(d?.suggestions)?d.suggestions.filter((s:unknown):s is string=>typeof s==="string"):[];
 }
 async playlist(id:string,nextpage?:string,signal?:AbortSignal){
  const page=Math.max(1,Number(nextpage)||1);
  const d=await this.request<Raw>("/api/v1/playlists/"+encodeURIComponent(id)+"?page="+page,signal);
  if(!d||!Array.isArray(d.videos))throw Error("プレイリスト応答の形式が不正です");
  const total=Number.isFinite(d.videoCount)?Number(d.videoCount):undefined;
  return {name:String(d.title||id),relatedStreams:d.videos.map((x:Raw)=>normalizeItem(x)),
    total, received:d.videos.length,
    fingerprint:JSON.stringify(d.videos.map((x:Raw)=>[x.videoId,x.index,x.title])),
    nextpage:d.videos.length && (total!==undefined ? page*100<total : d.videos.length>=100)?String(page+1):undefined};
 }
 async channel(path:string,signal?:AbortSignal):Promise<Track[]>{
  const id=path.match(/^\/channel\/([\w-]+)$/)?.[1]||(/^UC[\w-]+$/.test(path)?path:"");
  if(!id)throw Error("チャンネルURLに対応していません");
  const d=await this.request<Raw|Raw[]>("/api/v1/channels/"+encodeURIComponent(id)+"/videos",signal);
  const items=Array.isArray(d)?d:Array.isArray(d.videos)?d.videos:[];
  return items.map((x:Raw)=>fromItem(normalizeItem(x))).filter((x):x is Track=>!!x);
 }
 async check(){
  this.health.forEach(h=>h.cooldown=0);
  await Promise.allSettled(this.health.map(h=>this.at(h.url,"/api/v1/search?q=music&type=video",undefined,5000)));
 }
}
export function compatibleStreams(streams:AudioStream[],canPlay:(type:string)=>string,quality="balanced",allowMuxed=false){
 return streams.filter(s=>!!s.url?.startsWith("https://")&&
  (s.mimeType?.startsWith("audio/")||(allowMuxed&&s.mimeType==="video/mp4"))&&
  !!canPlay(s.mimeType+(s.codec?'; codecs="'+s.codec+'"':"")))
 .sort((a,b)=>{
  const target=quality==="data"?64000:quality==="high"?192000:128000;
  const score=(s:AudioStream)=>Math.abs((s.bitrate||128000)-target)+(s.mimeType==="audio/mp4"?-10000:0);
  return score(a)-score(b);
 });
}
export const invidious=new InvidiousClient();
