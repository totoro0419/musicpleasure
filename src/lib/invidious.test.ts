import {describe,it,expect,vi,afterEach} from "vitest";
import {InvidiousClient,normalizeItem,normalizeVideo,compatibleStreams} from "./invidious";
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
const health=(url:string)=>({url,success:0,failure:0,latency:0,cooldown:0,lastError:"",audioSuccess:0,lastChecked:0});
const videoId="XKiL253-5aY";
const video={
 videoId,title:"Cover A",author:"Singer",authorUrl:"/channel/UCtest",
 lengthSeconds:200,videoThumbnails:[{url:"https://i.ytimg.com/vi/"+videoId+"/hqdefault.jpg",width:480}],
 adaptiveFormats:[{url:"https://audio.test/ok",type:'audio/mp4; codecs="mp4a.40.2"',bitrate:"128000"}],
 formatStreams:[{url:"https://media.test/mux",type:"video/mp4",bitrate:"220000"}],
 recommendedVideos:[{videoId:"M7lc1UVf-VE",title:"Cover B",author:"Singer",lengthSeconds:150}]
};
describe("Invidious normalization",()=>{
 it("maps video and related video data to stable YouTube IDs",()=>{
  const info=normalizeVideo(video,"https://yt.chocolatemoo53.com",videoId);
  expect(info.title).toBe("Cover A");
  expect(info.duration).toBe(200);
  expect(info.audioStreams[0].bitrate).toBe(128000);
  expect(info.audioStreams[0].itag).toBeUndefined();
  expect(info.videoStreams?.[0].videoOnly).toBe(false);
  expect(info.relatedStreams[0].url).toContain("M7lc1UVf-VE");
 });
 it("maps search, thumbnails and channel identities",()=>{
  const item=normalizeItem(video);
  expect(item.url).toContain(videoId);
  expect(item.uploaderName).toBe("Singer");
  const channel=normalizeItem({type:"channel",author:"Singer",authorId:"UC123"});
  expect(channel.url).toBe("/channel/UC123");
 });
 it("selects playable audio without accidentally choosing video-only streams",()=>{
  expect(compatibleStreams(normalizeVideo(video,"https://yt.chocolatemoo53.com").audioStreams,()=>"probably")).toHaveLength(1);
 });
});
describe("Invidious HTTP and fallback",()=>{
 it("supports real array search schema and suggestions object",async()=>{
  const c=new InvidiousClient();c.health=[health("https://first.test")];
  vi.spyOn(c,"record").mockImplementation(()=>{});
  vi.stubGlobal("fetch",vi.fn(async(input:string)=>{
   if(input.includes("suggestions"))return new Response(JSON.stringify({query:"cover",suggestions:["cover A"]}),{status:200});
   return new Response(JSON.stringify([{type:"video",videoId,title:"Cover A",author:"Singer"}]),{status:200});
  }));
  expect((await c.search("cover")).items[0].url).toContain(videoId);
  expect(await c.suggestions("cover")).toEqual(["cover A"]);
 });
 it("normalizes /api/v1/videos/:id at the media request boundary",async()=>{
  const c=new InvidiousClient();c.health=[health("https://first.test")];vi.spyOn(c,"record").mockImplementation(()=>{});
  vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify(video),{status:200})));
  const result=await c.at<ReturnType<typeof normalizeVideo>>("https://first.test","/api/v1/videos/"+videoId);
  expect(result.audioStreams[0].url).toBe("https://audio.test/ok");
 });

 it("preserves the video id for local proxy API requests", async () => {
  const c=new InvidiousClient();c.health=[health("https://first.test")];
  vi.spyOn(c,"record").mockImplementation(()=>{});
  vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({
    ...video,videoId:undefined,
    adaptiveFormats:[{itag:"140",url:"/videoplayback?itag=140",type:"audio/mp4"}],
  }),{status:200})));
  const result=await c.at<ReturnType<typeof normalizeVideo>>(
    "https://first.test", "/api/v1/videos/"+videoId+"?local=true");
  expect(result.audioStreams[0].itag).toBe("140");
  expect(result.audioStreams[0].url).toBe("https://first.test/videoplayback?itag=140");
  expect(result.thumbnailUrl).toContain(videoId);
 });

 it("reaches a working instance after first-instance failure",async()=>{
  const c=new InvidiousClient();c.health=[health("https://bad.test"),health("https://good.test")];
  vi.spyOn(c,"record").mockImplementation(()=>{});
  vi.stubGlobal("fetch",vi.fn(async(input:string)=>new Response(
    JSON.stringify(input.includes("good")?[{type:"video",videoId,title:"Cover"}]:{error:"unavailable"}),
    {status:input.includes("good")?200:503}
  )));
  expect((await c.search("cover")).items).toHaveLength(1);
 });
 it("distinguishes upstream video refusal from generic HTTP failures",async()=>{
  const c=new InvidiousClient();c.health=[health("https://blocked.test")];
  vi.spyOn(c,"record").mockImplementation(()=>{});
  vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({error:"LOGIN_REQUIRED"}),{status:500})));
  await expect(c.at("https://blocked.test","/api/v1/videos/"+videoId)).rejects.toMatchObject({kind:"upstream_rejected"});
 });
 it("does not fetch after a pre-aborted search",async()=>{
  const c=new InvidiousClient();
  const fetchSpy=vi.fn();vi.stubGlobal("fetch",fetchSpy);
  const abort=new AbortController();abort.abort();
  await expect(c.search("cover",undefined,abort.signal)).rejects.toThrow();
  expect(fetchSpy).not.toHaveBeenCalled();
 });
});