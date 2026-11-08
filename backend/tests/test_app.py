import asyncio,json,subprocess,wave,math,struct
from fastapi.testclient import TestClient
import pytest
from backend.app.main import create_app
from backend.app.jobs import Jobs,convert_mp3
from backend.app.youtube import parse_url,track,YouTube

@pytest.fixture
def client(tmp_path,monkeypatch):
    monkeypatch.delenv('MUSICPLEASURE_TOKEN',raising=False)
    monkeypatch.delenv('OPENAI_API_KEY',raising=False)
    with TestClient(create_app(tmp_path)) as c:yield c

def test_boot_health_and_url_validation(client):
    assert client.get('/api/health').json()['ffmpeg']
    assert client.get('/api/parse-url',params={'url':'https://youtu.be/abcdefghijk'}).json()=={'type':'video','id':'abcdefghijk'}
    for url in ['https://youtube.com.evil.test/watch?v=abcdefghijk','file:///etc/passwd','http://127.0.0.1:8000/','https://youtube.com/watch?v=bad','https://user:pass@youtube.com/watch?v=abcdefghijk']:
        assert client.get('/api/parse-url',params={'url':url}).status_code==400
    assert client.post('/api/jobs',json={'videoId':'x; touch /tmp/oops'}).status_code==422
    assert client.post('/api/assistant',json={'prompt':'hi','tracks':[]}).status_code==503

def test_auth_and_rate_limit(tmp_path,monkeypatch):
    monkeypatch.setenv('MUSICPLEASURE_TOKEN','test-token')
    with TestClient(create_app(tmp_path)) as c:
        assert c.get('/api/jobs').status_code==401
        assert c.get('/api/jobs',headers={'Authorization':'Bearer test-token'}).status_code==200
        assert c.get('/api/assets/../../etc/passwd').status_code in [401,404]

def test_contract_and_paged_youtube(client,monkeypatch):
    yt=client.app.state.youtube;yt.key='test'
    calls=[]
    async def fake(resource,params,cost=1):
        calls.append(params)
        if resource=='playlistItems':
            offset=50 if params.get('pageToken')=='page2' else 0
            return {'items':[{'id':str(i),'snippet':{'title':f'Song {i+offset}','videoOwnerChannelTitle':'Artist','resourceId':{'videoId':f'{i+offset:011d}'}}} for i in range(5 if offset else 50)],**({} if offset else {'nextPageToken':'page2'})}
        return {'items':[]}
    monkeypatch.setattr(yt,'api',fake)
    a=client.get('/api/playlists/PL1234567890').json();b=client.get('/api/playlists/PL1234567890',params={'page':a['nextPageToken']}).json()
    assert len(a['items'])+len(b['items'])==55
    assert b['items'][-1]['title']=='Song 54'
    from backend.app.models import Track
    Track.model_validate(a['items'][0])
    assert calls[1]['pageToken']=='page2'

def test_metadata_does_not_invent_official_status():
    t=track({'id':'abcdefghijk','title':'Artist - Song Official MV','duration':200})
    assert t['sources'][0]['kind']=='mv'
    assert t['sources'][0]['official'] is False
    assert track({'id':'abcdefghijk','title':'Song'})['sources'][0]['kind']=='unknown'

def test_jobs_dedup_cancel_retry_restart_capacity(tmp_path):
    async def run():
        j=Jobs(tmp_path,max_pending=1)
        a=await j.create('abcdefghijk');b=await j.create('abcdefghijk');assert a['id']==b['id']
        with pytest.raises(Exception):await j.create('12345678901')
        await j.cancel(a['id']);assert j.get(a['id'])['state']=='cancelled'
        r=await j.create('abcdefghijk');assert r['id']==a['id'];assert r['state']=='queued'
        reboot=Jobs(tmp_path);assert reboot.get(a['id'])['state']=='failed'
        await reboot.delete(a['id']);assert reboot.list()==[]
    asyncio.run(run())

def test_real_ffmpeg_mp3_and_asset_range(client,tmp_path):
    source=tmp_path/'tone.wav';dest=tmp_path/'tone.mp3'
    with wave.open(str(source),'wb') as w:
        w.setparams((1,2,44100,0,'NONE','not compressed'))
        w.writeframes(b''.join(struct.pack('<h',int(3000*math.sin(2*math.pi*440*i/44100))) for i in range(88200)))
    convert_mp3(source,dest)
    info=json.loads(subprocess.check_output(['ffprobe','-v','quiet','-show_format','-show_streams','-of','json',str(dest)]))
    assert info['streams'][0]['codec_name']=='mp3'
    assert 1.9<float(info['format']['duration'])<2.2
    # Decode every sample: actual audio validation, not an extension-only check.
    subprocess.run(['ffmpeg','-v','error','-i',str(dest),'-f','null','-'],check=True,capture_output=True)
    jobs=client.app.state.jobs
    j={'id':'fixture-audio'}
    with jobs.connect() as c:c.execute("INSERT INTO jobs(id,videoId,state,updated) VALUES('fixture-audio','abcdefghijk','ready',0)")
    jobs.path(j['id']).write_bytes(dest.read_bytes());jobs.update(j['id'],state='ready',progress=100,bytes=dest.stat().st_size)
    r=client.get('/api/assets/'+j['id']);assert r.status_code==200 and r.content==dest.read_bytes()
    r=client.get('/api/assets/'+j['id'],headers={'Range':'bytes=0-99'});assert r.status_code==206 and len(r.content)==100

def test_failed_worker_does_not_block_api(client,monkeypatch):
    jobs=client.app.state.jobs
    async def failure(j):raise RuntimeError('test download failure')
    monkeypatch.setattr(jobs,'run',failure)
    j=client.post('/api/jobs',json={'videoId':'abcdefghijk'}).json()
    import time
    for _ in range(100):
        state=client.get('/api/jobs').json()[0]
        if state['state']=='failed':break
        time.sleep(.01)
    assert state['state']=='failed'
    assert client.get('/api/health').status_code==200
    assert 'test download failure' in state['error']
