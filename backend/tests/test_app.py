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
    with TestClient(create_app(tmp_path)) as c:
        session=c.post('/api/session',json={}).json()
        c.headers['Authorization']='Bearer '+session['token']
        yield c

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
    from backend.app.sessions import Sessions
    # Fixture asset is explicitly granted to the authenticated test device.
    import base64
    payload=client.headers['Authorization'].split(' ')[1].split('.')[0]
    device=json.loads(base64.urlsafe_b64decode(payload+'='*(-len(payload)%4)))['sub']
    with jobs.connect() as c:c.execute('INSERT INTO job_access VALUES(?,?)',(device,j['id']))
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

def test_device_sessions_are_scoped_and_never_expose_server_secret(tmp_path,monkeypatch):
    monkeypatch.setenv('SESSION_SECRET','server-only-'+'s'*48)
    app=create_app(tmp_path)
    async def no_download(j):pass
    monkeypatch.setattr(app.state.jobs,'run',no_download)
    with TestClient(app) as c:
        a=c.post('/api/session',json={}).json();b=c.post('/api/session',json={}).json()
        assert a['token']!=b['token'] and a['credential']!=b['credential']
        assert 'server-only' not in json.dumps(a)
        ha={'Authorization':'Bearer '+a['token']};hb={'Authorization':'Bearer '+b['token']}
        assert c.get('/api/jobs').status_code==401
        j=c.post('/api/jobs',json={'videoId':'abcdefghijk'},headers=ha).json()
        assert len(c.get('/api/jobs',headers=ha).json())==1
        assert c.get('/api/jobs',headers=hb).json()==[]
        assert c.get('/api/assets/'+j['id'],headers=hb).status_code==404
        renewed=c.post('/api/session',json={'credential':a['credential']}).json()
        assert c.get('/api/jobs',headers={'Authorization':'Bearer '+renewed['token']}).status_code==200
        assert c.post('/api/session',json={'credential':'bad'}).status_code==401
        denied=c.post('/api/session',json={},headers={'Origin':'https://evil.example'})
        assert denied.status_code==403
        forged=a['token'][:-4]+'nope'
        assert c.get('/api/jobs',headers={'Authorization':'Bearer '+forged}).status_code==401

def test_ip_limits_cannot_be_reset_by_new_device(tmp_path,monkeypatch):
    app=create_app(tmp_path)
    async def no_download(j):pass
    monkeypatch.setattr(app.state.jobs,'run',no_download)
    with TestClient(app) as c:
        for i in range(12):
            auth=c.post('/api/session',json={}).json()
            r=c.post('/api/jobs',json={'videoId':f'{i:011d}'},headers={'Authorization':'Bearer '+auth['token']})
            assert r.status_code==202
        auth=c.post('/api/session',json={}).json()
        assert c.post('/api/jobs',json={'videoId':'zzzzzzzzzzz'},headers={'Authorization':'Bearer '+auth['token']}).status_code==429

def test_cors_applies_to_auth_errors(tmp_path,monkeypatch):
    monkeypatch.setenv('CORS_ORIGINS','https://totoro0419.github.io')
    with TestClient(create_app(tmp_path)) as c:
        r=c.get('/api/jobs',headers={'Origin':'https://totoro0419.github.io'})
        assert r.status_code==401
        assert r.headers['access-control-allow-origin']=='https://totoro0419.github.io'
        r=c.options('/api/session',headers={'Origin':'https://totoro0419.github.io','Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type'})
        assert r.status_code==200

def test_simultaneous_create_and_retry_do_not_duplicate_worker_runs(tmp_path):
    async def run():
        jobs=Jobs(tmp_path)
        values=await asyncio.gather(*(jobs.create('abcdefghijk') for _ in range(8)))
        assert len({v['id'] for v in values})==1
        assert jobs.queue.qsize()==1
        calls=[]
        async def fake(job):
            calls.append(job['id'])
            jobs.update(job['id'],state='failed')
        jobs.run=fake
        await jobs.start();await jobs.queue.join()
        assert len(calls)==1
        await jobs.close()
    asyncio.run(run())

def test_ready_asset_corruption_is_retried_and_capacity_checked(tmp_path):
    async def run():
        jobs=Jobs(tmp_path)
        a=await jobs.create('abcdefghijk')
        jobs.path(a['id']).write_bytes(b'corrupt')
        jobs.update(a['id'],state='ready',bytes=7,sha256='bad')
        b=await jobs.create('abcdefghijk')
        assert b['state']=='queued' and not jobs.path(a['id']).exists()
        small=Jobs(tmp_path/'small',max_bytes=2)
        (small.root/'stored.mp3').write_bytes(b'oversize')
        with pytest.raises(Exception) as exc:await small.create('abcdefghijk')
        assert exc.value.status_code==507
    asyncio.run(run())

def test_invalid_mp3_is_not_a_ready_asset(tmp_path):
    from backend.app.jobs import validate_mp3
    path=tmp_path/'invalid.mp3';path.write_bytes(b'not an audio file')
    with pytest.raises(Exception):validate_mp3(path)

def test_worker_pipeline_validates_real_mp3_before_publication(tmp_path,monkeypatch):
    """Real subprocess/conversion/validation/storage; downloader is a fixture, not live YouTube."""
    async def run():
        jobs=Jobs(tmp_path)
        actual=asyncio.create_subprocess_exec
        async def fixture(*args,**kwargs):
            if '-m' in args and args[args.index('-m')+1]=='yt_dlp':
                pattern=Path(args[args.index('-o')+1]);output=pattern.parent/'audio.mp3'
                return await actual('ffmpeg','-v','error','-f','lavfi','-i','sine=frequency=440:duration=1','-y',str(output),**kwargs)
            return await actual(*args,**kwargs)
        monkeypatch.setattr(asyncio,'create_subprocess_exec',fixture)
        await jobs.start()
        j=await jobs.create('abcdefghijk');await jobs.queue.join()
        result=jobs.get(j['id'])
        assert result['state']=='ready' and result['bytes']>0
        assert jobs.path(j['id']).exists()
        await jobs.close()
        restored=Jobs(tmp_path)
        cached=await restored.create('abcdefghijk')
        assert cached['state']=='ready' and restored.queue.empty()
    from pathlib import Path
    asyncio.run(run())
