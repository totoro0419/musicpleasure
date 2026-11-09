# MusicPleasure

Android・PC向けのYouTube楽曲検索とMP3ライブラリ管理PWA。

公開フロントエンド: https://totoro0419.github.io/musicpleasure/

## 再生方式

再生ボタン → IndexedDBの保存音源を検証 → 未保存なら取得ジョブを自動投入 → yt-dlp / FFmpegでMP3化 → サーバーでデコード検証 → 端末へ保存 → HTMLAudioElementで再生。

YouTube IFrame Player API、埋め込みプレーヤー、失敗時のYouTube再生フォールバックは使用しません。YouTubeは検索・音源特定とバックエンド取得元として使用します。通常の再生にMP3保存ボタンや接続情報の入力は不要です。取得できない曲はエラーと再試行を表示します。

**公開バックエンドは未配備です。現在の公開検索サービスはMP3変換に対応しません。配備先と認証設定を準備し、`VITE_API_URL`または`frontend/public/runtime.json`の`apiUrl`へ公開HTTPS APIを設定するまで、Pagesからの未保存曲取得は利用できません。保存済みMP3・検索・ライブラリ管理は利用できます。**

## 実装した動作

- 保存済みMP3を優先し、再読み込み後・オフラインでも再利用。保存済み再生はAPIや認証サーバーを呼びません。
- 動画ID単位の取得共有、最大2並列、次の1曲のみ先読み。データセーバー・低速接続・オフラインでは先読みを控えます。プレイリストへの追加だけでは取得しません。
- 世代管理と再生意図管理で、曲切り替え・一時停止・停止後の取得完了による誤再生を防止。
- 再生、一時停止、停止、シーク、音量、前後送り、キュー、シャッフル、リピート、履歴、位置復元。
- Media Sessionの再生・一時停止・停止・前後送り・シークを接続。OSのロック画面・Bluetooth動作は各実機で別途確認が必要です。
- MP3ヘッダー・サイズ・SHA-256による端末キャッシュ検証。旧保存データは読み出し時に移行。ライブラリのスキーマ1を維持し、IndexedDBに端末認証ストアを追加。
- 端末MP3上限512MB、ブラウザ空き容量確認、削除時の確認、不要音源整理。プレイリスト削除では共有MP3を削除しません。
- YouTube検索、AIコピペ登録、アプリ内AIの操作案、プレイリスト編集、お気に入り、Undo/Redo、JSONバックアップ、PWAインストールを維持。アプリ内AIにはサーバー側のAPIキーが必要です。

## バックエンド

FastAPI + SQLite + yt-dlp + FFmpeg。永続ディスクと常駐する単一APIプロセスが必要です。通常の静的ホスティングや、プロセス・ローカルファイルが失われる実行環境へそのまま配備しないでください。

端末は自動登録で個別のランダム認証情報を取得します。長期資格情報のハッシュのみサーバーへ保存し、15分有効の署名付きセッションを発行・自動更新します。ブラウザへ共通秘密鍵を配布しません。認証情報は端末のIndexedDBへ保存し、JSONバックアップには含めません。これは公開アプリ向けの端末認証で、特定の人物だけに利用を限定するアカウント認証ではありません。

- `SESSION_SECRET`: サーバー専用、32文字以上。公開環境では必須。未設定の外部リクエストは拒否。
- `CORS_ORIGINS`: 公開フロントエンドの正確なoriginを列挙。Pagesのoriginは `https://totoro0419.github.io`。
- HTTPSを必須化。認証失敗応答にもCORSを適用。プロキシの背後では転送元とHTTPS情報を正しく設定。
- 各端末は自身の取得ジョブだけ参照可能。音源は動画IDで共有し、別端末が使うジョブの中止・削除を保護。
- IP / 端末ごと12回の取得要求/10分、180 API要求/分、認証20回/10分、最大2並列・30待機・サーバー5GB上限。IP制限は端末の再登録でリセットされません。
- サーバー再起動で中断ジョブを失敗状態へ移し、完成MP3は再利用。変換後のcodec・duration・全デコードとチェックサムを検証してからreadyにします。

### Docker / HTTPS配備

1. `.env.example`を`.env`へコピー。サーバー側で `SESSION_SECRET` を生成し、CORSとDNS名 `MUSICPLEASURE_DOMAIN` を設定。
2. DNSをホストへ向け、80/443番を開放。
3. 次を実行。CaddyがHTTPS証明書を取得・更新します。

```sh
docker compose -f compose.yaml -f compose.production.yaml up -d --build
```

`music-data`ボリュームにSQLiteとMP3を保存します。バックアップしてください。管理用トークン`MUSICPLEASURE_TOKEN`は任意で、公開ビルドに入れないでください。通常ユーザーは接続設定を変更しません。開発・診断用の接続設定のみ折りたたんで残しています。

GitHub Pagesを維持する場合は配備したAPI URLをリポジトリ変数 `MUSICPLEASURE_API_URL` に指定してPagesを再ビルドするか、`frontend/public/runtime.json`へ設定してください。URLは公開情報で、秘密情報は含めません。検索専用サービスへMP3要求を送って成功扱いすることはありません。

## 開発・検証

```sh
npm ci
python -m venv .venv
.venv/bin/pip install -r backend/requirements.lock
npm run dev
npm test
npm run build
npm run check:playback
.venv/bin/python -m pytest -q
# ffmpegとChromiumがあるCI環境
npm run e2e
```

Vitestは自動取得・保存再利用・オフライン・競合・先読み・取得失敗・破損・端末認証を検証。pytestは認証とジョブ隔離、制限、CORS、重複防止、再起動、MP3変換・整合性・配信を検証。PlaywrightはPC・Pixel 7相当・タブレット相当の操作とIFrame不生成を検証します。

ブラウザの自動再生制限で `play()` が拒否された場合は再試行を表示します。実際にplayingイベントが来るまで再生成功・履歴登録にはしません。

実YouTube取得テストはこの開発環境で認証確認要求と接続タイムアウトになり、成功は未確認です。生成音声を用いた変換・配信テストと、実YouTubeからの取得成功は別に扱います。
