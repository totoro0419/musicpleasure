import { describe, it, expect, vi, afterEach } from "vitest";
import { emptyData, newPlaylist, placeholder, validateBackup } from "./model";
import { planCommand } from "./importer";
import { fetchPlaylist, playlistJob } from "./playlist-import";
import { invidious } from "./invidious";
import { rankCandidates } from "./recommend";
const ids = ["M7lc1UVf-VE", "aqz-KE-bpKQ", "jfKfPfyJRdk"];
function fixture() {
 const d=emptyData();
 ids.forEach((id,i)=> d.tracks[id]={...placeholder(id),title:["Alpha cover","Beta","Gamma"][i],uploader:["Zed","Ann","Ann"][i],duration:60*(i+1)});
 d.playlists=[{...newPlaylist("通学"),tracks:[...ids,ids[0]],id:"p"},{...newPlaylist("夜",[ids[2]]),id:"q"}];d.favorites=[ids[0]];return d;
}
afterEach(()=>vi.restoreAllMocks());
describe("Japanese command plans: real library operations and safe previews",()=>{
 it("creates without a selected list",()=>expect(planCommand("「勉強」を作って","",emptyData()).execute(emptyData()).playlists[0].name).toBe("勉強"));
 it.each(["曲名順に並べ替え","タイトルの順にして"])("sorts titles: %s",text=>{const d=fixture(); expect(planCommand(text,"p",d).execute(d).playlists[0].tracks[0]).toBe(ids[0]);});
 it("sorts artist aliases",()=>{const d=fixture();expect(planCommand("アーティスト順に並べ替えて","p",d).execute(d).playlists[0].tracks[0]).toBe(ids[1]);});
 it("sorts descending duration",()=>{const d=fixture();expect(planCommand("時間の長い順にソート","p",d).execute(d).playlists[0].tracks[0]).toBe(ids[2]);});
 it("renames exactly the selected list",()=>{const d=fixture();expect(planCommand("名前を「朝」に変えて","p",d).execute(d).playlists[0].name).toBe("朝");});
 it("adds existing library songs",()=>{const d=fixture();d.playlists[0].tracks=[];expect(planCommand("「Beta」を入れて","p",d).execute(d).playlists[0].tracks).toEqual([ids[1]]);});
 it("deletes only matching list entries",()=>{const d=fixture();const r=planCommand("「Beta」を消して","p",d).execute(d);expect(r.playlists[0].tracks).not.toContain(ids[1]);expect(r.tracks[ids[1]]).toBeDefined();});
 it("moves favorites atomically",()=>{const d=fixture();const r=planCommand("お気に入りを「夜」へ移動","p",d).execute(d);expect(r.playlists[0].tracks).not.toContain(ids[0]);expect(r.playlists[1].tracks).toContain(ids[0]);});
 it("merges without deleting the source",()=>{const d=fixture();expect(planCommand("「夜」と統合して","p",d).execute(d).playlists).toHaveLength(2);});
 it("copies with a new identity",()=>{const d=fixture();const r=planCommand("「朝」として複製","p",d).execute(d);expect(r.playlists[2].tracks).toEqual([...new Set(d.playlists[0].tracks)]);expect(r.playlists[2].id).not.toBe("p");});
 it.each([["歌ってみたを抽出",[ids[0],ids[0]]],["お気に入りだけにして",[ids[0],ids[0]]],["2分以上の曲を取り出して",[ids[1],ids[2]]]])("filters: %s",(text,expected)=>{const d=fixture();expect(planCommand(text as string,"p",d).execute(d).playlists[0].tracks).toEqual(expected);});
 it("deduplicates exact track IDs",()=>{const d=fixture();expect(planCommand("重複を整理","p",d).execute(d).playlists[0].tracks).toEqual(ids);});
 it("rejects unrecognized, ambiguous, multi-operation and stale requests",()=>{const d=fixture();for(const text of ["良い感じにして","並べ替えて","削除して","曲名順にしてから削除","「存在しない」を消して"]) expect(()=>planCommand(text,"p",d)).toThrow();const plan=planCommand("曲名順に並べ替え","p",d);d.playlists[0].tracks=[];expect(()=>plan.execute(d)).toThrow(/プレビュー/);});
 it("does not infer a target among duplicate playlist names",()=>{const d=fixture();d.playlists.push(newPlaylist("夜"));expect(()=>planCommand("「夜」と結合","p",d)).toThrow(/複数/);});
});
function page(n:number,total=101) {return {name:"Import", relatedStreams:[{url:"https://youtube.com/watch?v="+ids[n],title:"Song"+n}],total, received:n?1:100,fingerprint:"page"+n,nextpage:n?undefined:"2"};}
describe("automatic playlist import",()=>{
 it("fetches every page sequentially, preserves unavailable entries and deduplicates",async()=>{
  vi.spyOn(invidious,"playlist").mockResolvedValueOnce({...page(0),relatedStreams:[...page(0).relatedStreams,{title:"[Private video]"}]}).mockResolvedValueOnce({...page(1),relatedStreams:[...page(0).relatedStreams,...page(1).relatedStreams]});
  const saved:any[]=[];const r=await fetchPlaylist(playlistJob("PLtest"),async j=>{saved.push(structuredClone(j));},new AbortController().signal);
  expect(r.status).toBe("complete");expect(r.tracks).toHaveLength(2);expect(r.unavailable[0].reason).toBe("非公開");expect(r.pages).toEqual(["1","2"]);expect(saved.length).toBeGreaterThan(2);
 });
 it("restores the next page after interruption",async()=>{
  const control=new AbortController();const spy=vi.spyOn(invidious,"playlist").mockResolvedValueOnce(page(0));let last=playlistJob("PLtest");
  await fetchPlaylist(last,async j=>{last=j;if(j.pages.length===1)control.abort();},control.signal);expect(last.status).toBe("paused");expect(last.next).toBe("2");
  spy.mockResolvedValueOnce(page(1));last=await fetchPlaylist(last,async()=>{},new AbortController().signal);expect(last.status).toBe("complete");expect(spy.mock.calls[1][1]).toBe("2");
 });
 it("retains partial results when a later page fails",async()=>{vi.spyOn(invidious,"playlist").mockResolvedValueOnce(page(0)).mockRejectedValue(Error("HTTP 500"));const r=await fetchPlaylist(playlistJob("PLtest"),async()=>{},new AbortController().signal);expect(r.status).toBe("error");expect(r.tracks).toHaveLength(1);expect(r.next).toBe("2");});
 it("does not claim completion for repeated or truncated pages",async()=>{const spy=vi.spyOn(invidious,"playlist").mockResolvedValue(page(0));let r=await fetchPlaylist(playlistJob("PLtest"),async()=>{},new AbortController().signal);expect(r.status).toBe("error");spy.mockReset().mockResolvedValue({...page(0),nextpage:undefined});r=await fetchPlaylist(playlistJob("PLtest"),async()=>{},new AbortController().signal);expect(r.status).toBe("error");});
});
describe("recommendation signals",()=>{
 it("excludes disliked songs in all six modes and honors cover/channel modes",()=>{const d=fixture();d.queue=[];d.disliked=[ids[1]];const seed={...d.tracks[ids[2]],id:"XXXXXXXXXXX"};for(const mode of ["favorites","balance","discovery","covers","channel","versions"] as const){const r=rankCandidates(Object.values(d.tracks),seed,d,mode);expect(r.map(t=>t.id)).not.toContain(ids[1]);if(mode==="covers")expect(r.every(t=>t.title.includes("cover"))).toBe(true);if(mode==="channel")expect(r.every(t=>t.uploader===seed.uploader)).toBe(true);}});
 it("retains additions across backup validation",()=>{const d=fixture();d.additions={[ids[0]]:3};expect(validateBackup(d).additions?.[ids[0]]).toBe(3);});
});
