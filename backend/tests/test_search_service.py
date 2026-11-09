from fastapi.testclient import TestClient
from backend.search_service import app, youtube

def test_public_search_preserves_contract_without_exposing_audio_jobs(monkeypatch):
    async def search(q, page, kind):
        return {"items": [], "nextPageToken": "", "provider": "test-fixture"}
    monkeypatch.setattr(youtube, "search", search)
    with TestClient(app) as client:
        result = client.get('/api/search', params={'q':'song'}, headers={'Origin':'https://totoro0419.github.io'})
        assert result.status_code == 200
        assert result.headers['access-control-allow-origin'] == 'https://totoro0419.github.io'
        assert result.json()['provider'] == 'test-fixture'
        assert client.get('/api/health').json()['capabilities']['downloads'] is False
        assert client.post('/api/jobs', json={'videoId':'abcdefghijk'}).status_code == 503
        assert client.get('/api/parse-url',params={'url':'http://127.0.0.1/private'}).status_code == 400
