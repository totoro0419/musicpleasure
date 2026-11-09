import sys
import asyncio,json,sqlite3,time,uuid,shutil,os,hashlib,subprocess
from contextlib import contextmanager
from pathlib import Path
from fastapi import HTTPException

TERMINAL={'ready','failed','cancelled'}
def checksum(path):
    with path.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()

def validate_mp3(path):
    result=subprocess.run(['ffprobe','-v','error','-show_entries','stream=codec_name:format=duration','-of','json',str(path)],check=True,capture_output=True,timeout=15)
    info=json.loads(result.stdout)
    if not any(v.get('codec_name')=='mp3' for v in info.get('streams',[])) or float(info.get('format',{}).get('duration',0))<=0:
        raise RuntimeError('有効なMP3音源ではありません')
    subprocess.run(['ffmpeg','-nostdin','-v','error','-xerror','-i',str(path),'-f','null','-'],check=True,capture_output=True,timeout=60)
    return checksum(path)

def public_job(row):
    value=dict(row)
    if value['state'] in ('queued','converting','failed','cancelled') or value['progress']<0:value['progress']=None
    value.pop('sha256',None)
    return value

def convert_mp3(source:Path,dest:Path):
    import subprocess
    subprocess.run(['ffmpeg','-nostdin','-y','-i',str(source),'-vn','-codec:a','libmp3lame','-b:a','192k',str(dest)],check=True,capture_output=True,timeout=60)

class Jobs:
    def __init__(self,root:Path,max_bytes=5*1024**3,concurrency=2,max_pending=30):
        self.root=root;root.mkdir(parents=True,exist_ok=True)
        self.max_bytes=max_bytes;self.concurrency=concurrency;self.max_pending=max_pending
        self.db=root/'musicpleasure.sqlite3';self.queue=asyncio.Queue();self.workers=[];self.procs={};self.create_lock=asyncio.Lock()
        with self.connect() as c:
            c.execute('PRAGMA journal_mode=WAL')
            c.execute('CREATE TABLE IF NOT EXISTS schema_version(version INTEGER)')
            if not c.execute('SELECT * FROM schema_version').fetchone():c.execute('INSERT INTO schema_version VALUES(1)')
            c.execute('CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, videoId TEXT UNIQUE NOT NULL, state TEXT NOT NULL, progress REAL NOT NULL DEFAULT 0, attempt INTEGER NOT NULL DEFAULT 0, error TEXT, bytes INTEGER NOT NULL DEFAULT 0, updated REAL NOT NULL)')
            if 'sha256' not in [r[1] for r in c.execute('PRAGMA table_info(jobs)')]:c.execute("ALTER TABLE jobs ADD COLUMN sha256 TEXT DEFAULT ''")
            c.execute("UPDATE jobs SET state='failed',error='サーバー再起動で中断しました。再試行できます' WHERE state NOT IN ('ready','failed','cancelled')")
        for p in root.glob('tmp-*'):shutil.rmtree(p,ignore_errors=True)
    @contextmanager
    def connect(self):
        c=sqlite3.connect(self.db,timeout=10);c.row_factory=sqlite3.Row
        try:
            with c:yield c
        finally:c.close()
    def list(self):
        with self.connect() as c:return [public_job(v) for v in c.execute('SELECT * FROM jobs ORDER BY updated DESC')]
    def get(self,ident):
        with self.connect() as c:row=c.execute('SELECT * FROM jobs WHERE id=?',(ident,)).fetchone()
        if not row:raise HTTPException(404,'ジョブが見つかりません')
        return public_job(row)
    def update(self,ident,**fields):
        fields['updated']=time.time()
        with self.connect() as c:c.execute('UPDATE jobs SET '+','.join(f'{k}=?' for k in fields)+' WHERE id=?',[*fields.values(),ident])
    def usage(self):return sum(p.stat().st_size for p in self.root.rglob('*') if p.is_file() and (p.suffix=='.mp3' or p.parent.name.startswith('tmp-')))
    async def start(self):self.workers=[asyncio.create_task(self.worker()) for _ in range(self.concurrency)]
    async def close(self):
        for p in list(self.procs.values()):
            if p.returncode is None:p.kill()
        for t in self.workers:t.cancel()
        await asyncio.gather(*self.workers,return_exceptions=True)
    async def create(self,video):
        async with self.create_lock:return await self._create(video)
    async def _create(self,video):
        with self.connect() as c:row=c.execute('SELECT * FROM jobs WHERE videoId=?',(video,)).fetchone()
        if row:
            job=dict(row)
            if job['state']=='ready':
                path=self.path(job['id'])
                valid=path.exists() and path.stat().st_size==job['bytes']
                if valid:
                    try:
                        actual=await asyncio.to_thread(checksum,path)
                        valid=actual==job['sha256'] if job['sha256'] else bool(await asyncio.to_thread(validate_mp3,path))
                        if valid and not job['sha256']:self.update(job['id'],sha256=actual)
                    except Exception:valid=False
                if not valid:
                    self.update(job['id'],state='failed',error='保存音源が破損しています。再取得します');job['state']='failed'
            if job['id'] in self.procs and job['state'] in ('failed','cancelled'):
                raise HTTPException(409,'前の取得を中止しています。少し待って再試行してください')
            if job['state'] not in ('failed','cancelled'):return public_job(job)
            if job['attempt']>=3:raise HTTPException(409,'再試行上限（3回）です。保存管理から削除すると再登録できます')
            ident=job['id']
        else:ident=uuid.uuid4().hex
        pending=sum(j['state'] not in TERMINAL for j in self.list())
        if pending>=self.max_pending:raise HTTPException(429,'ジョブが混雑しています。完了を待って再試行してください')
        if self.usage()>=self.max_bytes:raise HTTPException(507,'保存容量が不足しています')
        with self.connect() as c:
            c.execute("INSERT INTO jobs(id,videoId,state,updated) VALUES(?,?,'queued',?) ON CONFLICT(videoId) DO UPDATE SET state='queued',error=NULL,progress=0,updated=excluded.updated",(ident,video,time.time()))
        self.path(ident).unlink(missing_ok=True)
        await self.queue.put(ident);return self.get(ident)
    async def cancel(self,ident):
        j=self.get(ident)
        if j['state']=='ready':return j
        self.update(ident,state='cancelled')
        p=self.procs.get(ident)
        if p and p.returncode is None:p.kill()
        return self.get(ident)
    async def delete(self,ident):
        await self.cancel(ident)
        if ident in self.procs:raise HTTPException(409,'キャンセル処理中です。少し待って削除してください')
        self.path(ident).unlink(missing_ok=True)
        with self.connect() as c:c.execute('DELETE FROM jobs WHERE id=?',(ident,))
    def path(self,ident):return self.root/f'{ident}.mp3'
    async def worker(self):
        while True:
            ident=await self.queue.get()
            try:
                j=self.get(ident)
                if j['state']=='queued':
                    self.update(ident,state='downloading',attempt=j['attempt']+1,progress=-1,error=None)
                    await self.run(self.get(ident))
            except asyncio.CancelledError:raise
            except Exception as e:
                try:
                    if self.get(ident)['state']!='cancelled':self.update(ident,state='failed',error=str(e)[:400])
                except HTTPException:pass
            finally:self.queue.task_done()
    async def run(self,j):
        ident=j['id'];temp=self.root/f'tmp-{ident}';temp.mkdir(exist_ok=True)
        self.update(ident,state='downloading',error=None)
        # No shell, arbitrary URLs, config loading, playlists, cookies, or executable hooks.
        args=[sys.executable,'-m','yt_dlp','--compat-options','no-certifi','--js-runtimes','node','--ignore-config','--no-playlist','--no-warnings','--newline','--progress','--progress-template','download:%(progress._percent_str)s','--socket-timeout','15','--retries','1','--fragment-retries','1','--max-filesize','150M','--match-filter','duration <= 1800','-f','bestaudio/best','-x','--audio-format','mp3','--audio-quality','192K','--restrict-filenames','-o',str(temp/'audio.%(ext)s'),'--',f"https://www.youtube.com/watch?v={j['videoId']}"]
        p=await asyncio.create_subprocess_exec(*args,stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.STDOUT,env={**os.environ,'PYTHONUNBUFFERED':'1'});self.procs[ident]=p
        async def monitor():
            logs=[];last=0
            while line:=await p.stdout.readline():
                msg=line.decode(errors='replace').strip();logs.append(msg);logs=logs[-10:]
                if self.get(ident)['state']=='cancelled':continue
                import re
                m=re.fullmatch(r'download:\s*([\d.]+)%',msg)
                if m and time.time()-last>.3:
                    self.update(ident,progress=min(99,float(m[1])));last=time.time()
                if '[ExtractAudio]' in msg:self.update(ident,state='converting',progress=-1)
                if self.usage()>self.max_bytes:
                    p.kill();raise RuntimeError('保存容量上限に達しました')
            await p.wait()
            if p.returncode:raise RuntimeError('音声取得・変換に失敗しました。動画の公開状態と接続を確認してください')
        try:
            await asyncio.wait_for(monitor(),300)
            if self.get(ident)['state']=='cancelled':return
            output=temp/'audio.mp3'
            if not output.exists() or output.stat().st_size==0:raise RuntimeError('MP3ファイルが生成されませんでした')
            if self.usage()>self.max_bytes:raise RuntimeError('保存容量上限に達しました')
            digest=await asyncio.to_thread(validate_mp3,output)
            if self.get(ident)['state']=='cancelled':return
            output.replace(self.path(ident));self.update(ident,state='ready',progress=100,bytes=self.path(ident).stat().st_size,sha256=digest)
        finally:
            if p.returncode is None:p.kill();await p.wait()
            self.procs.pop(ident,None);shutil.rmtree(temp,ignore_errors=True)
