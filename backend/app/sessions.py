"""Server-issued per-device credentials; no shared browser secret.

Public enrollment is intended for a bounded public app, not an allowlist of people.
IP limits apply before enrollment so new credentials cannot evade download limits.
"""
import base64, hashlib, hmac, json, secrets, time
from fastapi import HTTPException

class Sessions:
    def __init__(self, jobs, secret):
        self.jobs = jobs
        self.secret = secret.encode()
        with jobs.connect() as c:
            c.execute('CREATE TABLE IF NOT EXISTS devices (id TEXT PRIMARY KEY, credential TEXT UNIQUE, updated REAL)')
            c.execute('CREATE TABLE IF NOT EXISTS job_access (device TEXT, job TEXT, PRIMARY KEY(device,job))')

    def issue(self, credential=''):
        device = None
        if credential:
            hashed = hashlib.sha256(credential.encode()).hexdigest()
            with self.jobs.connect() as c:
                row = c.execute('SELECT id FROM devices WHERE credential=?', (hashed,)).fetchone()
            if row: device = row['id']
            else: raise HTTPException(401, '端末の認証情報が無効です')
        else:
            device, credential = secrets.token_urlsafe(24), secrets.token_urlsafe(48)
            with self.jobs.connect() as c:
                # Bound persistent anonymous enrollment storage as well as request volume.
                if c.execute('SELECT count(*) FROM devices').fetchone()[0] >= 10000:
                    raise HTTPException(503, '端末登録の上限です。管理者に連絡してください')
                c.execute('INSERT INTO devices VALUES(?,?,?)', (device, hashlib.sha256(credential.encode()).hexdigest(), time.time()))
        expires = int(time.time()) + 900
        payload = base64.urlsafe_b64encode(json.dumps({'sub':device,'exp':expires},separators=(',',':')).encode()).decode().rstrip('=')
        signature = hmac.new(self.secret,payload.encode(),hashlib.sha256).hexdigest()
        return {'token':payload+'.'+signature,'expiresAt':expires*1000,'credential':credential}

    def verify(self, authorization):
        try:
            scheme, token = authorization.split(' ',1)
            payload, signature = token.split('.',1)
            expected = hmac.new(self.secret,payload.encode(),hashlib.sha256).hexdigest()
            if scheme != 'Bearer' or not hmac.compare_digest(signature,expected): raise ValueError()
            value = json.loads(base64.urlsafe_b64decode(payload + '=' * (-len(payload)%4)))
            if value['exp'] <= time.time(): raise ValueError()
            with self.jobs.connect() as c:
                if not c.execute('SELECT 1 FROM devices WHERE id=?',(value['sub'],)).fetchone():raise ValueError()
            return value['sub']
        except (ValueError, KeyError, TypeError):
            raise HTTPException(401, '端末の認証が失効しました。再試行してください')

    def grant(self, device, job):
        if device == 'admin': return
        with self.jobs.connect() as c:c.execute('INSERT OR IGNORE INTO job_access VALUES(?,?)',(device,job))

    def allowed(self, device, job):
        if device == 'admin':return True
        with self.jobs.connect() as c:
            return bool(c.execute('SELECT 1 FROM job_access WHERE device=? AND job=?',(device,job)).fetchone())

    def check(self, device, job):
        if not self.allowed(device,job):raise HTTPException(404,'ジョブが見つかりません')

    def shared(self, device, job):
        with self.jobs.connect() as c:
            return bool(c.execute('SELECT 1 FROM job_access WHERE job=? AND device<>?',(job,device)).fetchone())
