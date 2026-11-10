"""Real-service Piped investigation; never counts HTTP 200 as playback."""
import argparse
import concurrent.futures
import datetime
import json
import pathlib
import re
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument('--runtime', required=True)
args = parser.parse_args()
root = pathlib.Path(__file__).resolve().parents[1]
tracks = json.loads((root / 'tests/fixtures/piped-tracks.json').read_text())
output = root / 'investigation-results'
output.mkdir(exist_ok=True)
api = 'http://127.0.0.1:8091'
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def request(url, headers=None, timeout=15):
    try:
        return opener.open(urllib.request.Request(url, headers=headers or {}), timeout=timeout)
    except urllib.error.HTTPError as response:
        return response


def sanitized(error):
    return re.sub(r'https?://\S+', '[URL omitted]', str(error))[:300]


for attempt in range(60):
    try:
        with request(api + '/version', timeout=1) as response:
            if response.status == 200:
                version = response.read().decode().strip()
                break
    except Exception:
        pass
    time.sleep(1)
else:
    raise RuntimeError('Piped API did not become ready')


def probe(track):
    started = time.monotonic()
    row = {'id': track['id'], 'cover': track['cover'], 'runtime': args.runtime,
           'version': version, 'at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
           'request': api + '/streams/' + track['id'], 'media': [],
           'browserPlayback': 'not tested'}
    try:
        with request(row['request'], timeout=20) as response:
            row['status'] = response.status
            row['apiType'] = response.headers.get('Content-Type')
            data = json.load(response)
        row.update({'title': data.get('title'), 'audioCount': len(data.get('audioStreams', [])),
                    'videoCount': len(data.get('videoStreams', [])), 'hls': bool(data.get('hls')),
                    'message': sanitized(data.get('message', ''))})
        if row['status'] == 200:
            streams = data.get('audioStreams', [])
            if streams:
                # Compare AAC with Opus when possible. No endless retries.
                mp4 = next((s for s in streams if s.get('mimeType') == 'audio/mp4' and s.get('codec') == 'mp4a.40.2'), None)
                opus = next((s for s in streams if s.get('mimeType') == 'audio/webm'), None)
                candidates = [s for s in [mp4, opus] if s] or streams[:1]
            else:
                candidates = [s for s in data.get('videoStreams', [])
                              if not s.get('videoOnly') and s.get('mimeType') == 'video/mp4'][:1]
            for stream in candidates:
                # Only use the media proxy returned by our Piped Backend.
                parsed = urllib.parse.urlparse(stream['url'])
                if (parsed.hostname, parsed.port) not in [('127.0.0.1', 8092), ('localhost', 8443)]:
                    raise ValueError('Unexpected media origin from trial Piped')
                query = urllib.parse.parse_qs(parsed.query)
                media = {key: stream.get(key) for key in ['mimeType', 'codec', 'quality', 'bitrate']}
                media.update({'host': parsed.hostname, 'client': query.get('c', [None])[0],
                              'expiry': query.get('expire', [None])[0], 'decode': 'not attempted'})
                row['media'].append(media)
                with request(stream['url'], {'Range': 'bytes=0-16383'}) as response:
                    head = response.read(16384)
                    media.update({'status': response.status, 'type': response.headers.get('Content-Type'),
                                  'range': response.headers.get('Content-Range'), 'bytes': len(head),
                                  'mp4': head[4:8] == b'ftyp', 'webm': head[:4] == b'\x1aE\xdf\xa3'})
                if media['status'] not in [200, 206] or not (media['mp4'] or media['webm']):
                    continue
                result = subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error',
                    '-i', stream['url'], '-map', '0:a:0', '-t', '3', '-f', 'null', '-'],
                    capture_output=True, timeout=35)
                media['decode'] = 'passed' if result.returncode == 0 else 'failed'
                media['decodeExit'] = result.returncode
                if result.stderr: media['decodeError'] = sanitized(result.stderr.decode(errors='replace'))
                if media['decode'] == 'passed': break
    except Exception as error:
        row['error'] = sanitized(error)
    row['elapsedMs'] = round((time.monotonic() - started) * 1000)
    return row


rows = []
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    for row in pool.map(probe, tracks):
        rows.append(row)
        print('PIPED_TRIAL', json.dumps(row, ensure_ascii=False), flush=True)
report = {'runtime': args.runtime, 'version': version, 'tracks': rows,
          'apiSuccess': sum(row.get('status') == 200 for row in rows),
          'decodeSuccess': sum(any(media.get('decode') == 'passed' for media in row['media']) for row in rows),
          'browserPlayback': 'not tested', 'continuousThree': 'not tested', 'radio': 'not tested'}
(output / (args.runtime + '.json')).write_text(json.dumps(report, ensure_ascii=False, indent=2))
print('PIPED_TRIAL_SUMMARY', json.dumps({k: v for k, v in report.items() if k != 'tracks'}), flush=True)
