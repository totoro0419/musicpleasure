import sys
import asyncio, html, json, re, time
from urllib.parse import urlparse,parse_qs
import httpx
from fastapi import HTTPException

VIDEO = re.compile(r'^[\w-]{11}$',re.ASCII)
PLAYLIST = re.compile(r'^[\w-]{10,100}$',re.ASCII)
def parse_url(value: str):
    p=urlparse(value.strip())
    if p.scheme not in ('https','http') or p.hostname not in ('youtube.com','www.youtube.com','m.youtube.com','music.youtube.com','youtu.be') or p.username or p.password or p.port:
        raise ValueError('YouTubeの動画・プレイリストURLを入力してください')
    q=parse_qs(p.query)
    vid = p.path.strip('/') if p.hostname=='youtu.be' else (q.get('v',[''])[0] or (p.path.split('/')[2] if p.path.startswith(('/shorts/','/embed/')) else ''))
    playlist=q.get('list',[''])[0]
    if playlist and PLAYLIST.fullmatch(playlist): return {'type':'playlist','id':playlist}
    if VIDEO.fullmatch(vid): return {'type':'video','id':vid}
    raise ValueError('有効な動画IDまたはプレイリストIDがありません')
def classify(title):
    for kind,pattern in [('live',r'\blive\b|ライブ|ライヴ'),('cover',r'\bcover\b|歌ってみた'),('remix',r'\bremix\b|リミックス'),('mv',r'\bMV\b|music video'),('audio',r'official audio|audio only')]:
        if re.search(pattern,title,re.I): return kind,'タイトル表記による分類（公式性は未確認）'
    return 'unknown','未確認'
def seconds(value):
    m=re.fullmatch(r'P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?',value or '')
    return sum(int(v or 0)*s for v,s in zip(m.groups(),[86400,3600,60,1])) if m else 0
def track(raw):
    snippet=raw.get('snippet',{})
    ident=raw.get('id')
    vid=ident.get('videoId') if isinstance(ident,dict) else ident
    vid=snippet.get('resourceId',{}).get('videoId',vid)
    title=html.unescape(snippet.get('title',raw.get('title','名称未取得')))
    thumbs=snippet.get('thumbnails',{})
    kind,evidence=classify(title)
    return {'id':f'yt:{vid}','title':title,'artist':html.unescape(snippet.get('videoOwnerChannelTitle',snippet.get('channelTitle',raw.get('channel',raw.get('uploader','未確認')))) or '未確認'), 'duration':seconds(raw.get('contentDetails',{}).get('duration','')) or raw.get('duration') or 0,'thumbnail':thumbs.get('medium',thumbs.get('default',{})).get('url',raw.get('thumbnail',(raw.get('thumbnails') or [{}])[-1].get('url',''))) or '', 'sources':[{'id':f'youtube:{vid}','provider':'youtube','videoId':vid,'url':f'https://www.youtube.com/watch?v={vid}','kind':kind,'evidence':evidence,'official':False}]}

class YouTube:
    def __init__(self,key,quota=8000):
        self.key=key;self.quota=quota;self.spent=0;self.day=time.strftime('%Y-%m-%d');self.cache={};self.locks={};self.limit=asyncio.Semaphore(2)
    async def api(self,resource,params,cost=1):
        if self.day!=time.strftime('%Y-%m-%d'):self.day=time.strftime('%Y-%m-%d');self.spent=0
        if self.spent+cost>self.quota:raise HTTPException(429,'アプリの1日API割り当て上限に達しました')
        self.spent+=cost
        async with httpx.AsyncClient(timeout=25) as c:
            r=await c.get(f'https://www.googleapis.com/youtube/v3/{resource}',params={**params,'key':self.key})
        if r.status_code!=200:raise HTTPException(502,'YouTube APIで取得できませんでした。キー・割り当て・公開状態を確認してください')
        return r.json()
    async def extract(self,target):
        # target is constructed internally from a validated ID or bounded search string.
        async with self.limit:
            p=await asyncio.create_subprocess_exec(sys.executable,'-m','yt_dlp','--compat-options','no-certifi','--js-runtimes','node','--ignore-config','--no-warnings','--flat-playlist','--dump-single-json','--socket-timeout','15','--',target,stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.PIPE)
            try:
                out,err=await asyncio.wait_for(p.communicate(),50)
            except (TimeoutError,asyncio.CancelledError):
                p.kill();await p.communicate();raise HTTPException(504,'YouTube取得がタイムアウトしました')
            if p.returncode:raise HTTPException(502,'YouTubeに接続できませんでした。時間をおいて再試行してください')
            return json.loads(out)
    async def search(self,q,page='',kind='all'):
        key=(q,page,kind)
        if key in self.cache and time.time()-self.cache[key][0]<900:return self.cache[key][1]
        lock=self.locks.setdefault(key,asyncio.Lock())
        async with lock:
            if key in self.cache and time.time()-self.cache[key][0]<900:return self.cache[key][1]
            if q.startswith(('http://','https://')):
                try:ref=parse_url(q)
                except ValueError as e:raise HTTPException(400,str(e))
                if ref['type']=='playlist':return await self.playlist(ref['id'],page)
                if self.key:
                    data=await self.api('videos',{'part':'snippet,contentDetails','id':ref['id']});items=[track(v) for v in data['items']]
                else:items=[track(await self.extract(f"https://www.youtube.com/watch?v={ref['id']}"))]
                result={'items':items,'nextPageToken':'','provider':'youtube-data-api' if self.key else 'yt-dlp'}
            elif self.key:
                data=await self.api('search',{'part':'snippet','type':'video','q':q,'maxResults':25,'pageToken':page},100)
                ids=','.join(v['id']['videoId'] for v in data['items'])
                details=await self.api('videos',{'part':'snippet,contentDetails','id':ids}) if ids else {'items':[]}
                result={'items':[track(v) for v in details['items']],'nextPageToken':data.get('nextPageToken',''),'provider':'youtube-data-api'}
            else:
                if page:raise HTTPException(400,'ページングにはYouTube Data APIキーを設定してください')
                data=await self.extract(f'ytsearch25:{q}')
                result={'items':[track(v) for v in data.get('entries',[]) if v],'nextPageToken':'','provider':'yt-dlp'}
            if kind!='all':result['items']=[v for v in result['items'] if v['sources'][0]['kind']==kind]
            # Exact normalized title/artist matches precede partial matches; official status never inferred.
            norm=lambda v:re.sub(r'\s+','',v.casefold())
            result['items'].sort(key=lambda v: norm(q) not in norm(v['title']+' '+v['artist']))
            if len(self.cache)>200:self.cache.pop(next(iter(self.cache)))
            self.cache[key]=(time.time(),result)
            return result
    async def playlist(self,ident,page=''):
        if not PLAYLIST.fullmatch(ident):raise HTTPException(400,'無効なプレイリストID')
        if self.key:
            data=await self.api('playlistItems',{'part':'snippet','playlistId':ident,'maxResults':50,'pageToken':page})
            return {'items':[track(v) for v in data['items'] if v['snippet'].get('resourceId',{}).get('videoId') and v['snippet']['title'] not in ['Deleted video','Private video']],'nextPageToken':data.get('nextPageToken',''),'provider':'youtube-data-api'}
        data=await self.extract(f'https://www.youtube.com/playlist?list={ident}')
        return {'items':[track(v) for v in data.get('entries',[]) if v],'nextPageToken':'','provider':'yt-dlp'}
