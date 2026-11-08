# MusicPleasure

YouTube検索・MP3保存再生・AIプレイリストをまとめる、日本語の音楽PWA。React 19 / TypeScript / Vite、FastAPI、SQLite、yt-dlp、FFmpegを使用します。

フロントエンドプレビュー: https://musicpleasure-ibuki.ibukioike2009.chatgpt.site （所有者向け）

**このプレビューは静的フロントエンドです。YouTube検索・音声取得・アプリ内AIには別途バックエンド接続が必要です。端末からMP3を読み込めば、バックエンドなしで保存・再生・プレイリスト管理ができます。**

## すぐ使う: Docker

必要: Docker Engine / Docker Desktop + Compose。

```sh
cp .env.example .env
# .env の MUSICPLEASURE_TOKEN に十分長いランダム文字列を設定
# YouTube Data APIを使う場合は YOUTUBE_API_KEY も設定
# アプリ内AIを使う場合は OPENAI_API_KEY も設定
# 例: python -c "import secrets; print(secrets.token_urlsafe(32))"
docker compose up --build -d
```

http://localhost:8080 を開き、**設定・接続**に `.env` の接続トークンを入力して保存します。同一ホストならAPI URLは空欄。バックエンドは http://127.0.0.1:8000/docs で確認できます。

AndroidからはPC/サーバーのLANアドレスを使用します。PWA・Service Worker・安定したオフライン起動にはHTTPSが必要です。リバースプロキシでTLSを終端してください。HTTPSの公開フロントエンドからHTTPのLANバックエンドへの接続は推奨しません。公開フロントエンド用にはHTTPSのAPIを用意します。

## 開発環境

Node.js 24、Python 3.12、FFmpeg（ffprobeを含む）を用意してください。

```sh
npm ci
python -m venv .venv
# Linux / macOS
.venv/bin/pip install -r backend/requirements.lock
npm run dev
```

`npm run dev` は `.venv/bin/python` があればFastAPIとViteを起動します。Viteの `/api` は127.0.0.1:8000に転送します。Windowsでは2つのターミナルで実行してください。

```powershell
.venv\Scripts\python -m pip install -r backend/requirements.lock
.venv\Scripts\python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
# 別ターミナル
npx vite --host 127.0.0.1
```

Pythonを直接起動する場合、環境変数は起動前にシェルへ設定してください。Composeは `.env` を読み込みますが、直接のuvicorn起動では `.env` を自動読込しません（必要なら `--env-file .env`）。

```sh
npm run build
npm test
.venv/bin/python -m pytest -q
# ブラウザ試験（通常の開発環境 / CI）
npx playwright install chromium
npm run build && npm run e2e
```

## APIとキー

| 変数 | 用途 | 未設定時 |
|---|---|---|
| `MUSICPLEASURE_TOKEN` | 単一ユーザー用Bearer認証 | ループバックからのみ利用可能。Composeでは必須 |
| `YOUTUBE_API_KEY` | YouTube Data API v3 | yt-dlpによる検索・メタデータ取得を試行 |
| `YOUTUBE_DAILY_BUDGET` | アプリ内1日割り当て上限 | 8,000。検索100、詳細・プレイリスト1を加算 |
| `OPENAI_API_KEY` | アプリ内AIアシスタント | AIアシスタントは未設定表示。ルール式取り込みは利用可 |
| `OPENAI_MODEL` | AI操作案を生成するモデル | `gpt-4.1-mini` |
| `CORS_ORIGINS` | 接続を許可するフロントエンドorigin（カンマ区切り） | localhost開発環境 |
| `DATA_DIR` | SQLiteとサーバーMP3の保存先 | `data` / Dockerでは `/data` |
| `MAX_STORAGE_BYTES` | サーバー音声ファイル容量上限 | 5GiB |
| `VITE_API_URL` | ビルド時の初期API URL（公開情報のみ） | 同一originの `/api` |
| `VITE_BASE_PATH` | 静的公開のベースパス | `/` |

Google Cloud ConsoleでYouTube Data API v3を有効化し、サーバー用キーを作成します。キーはサーバーへ設定し、フロントエンドの `VITE_*` やGitに含めません。Data APIを使うと検索ページングと50件単位のプレイリスト取得を利用できます。インポートは次ページを終端まで取得します（安全上限5,000曲）。キーなしの検索は最大25件で、ページング非対応です。

公式性は推測しません。MV・ライブ・カバー等の区分はタイトル内の表記が根拠で、ツールチップに明記します。アーティスト欄はYouTubeのチャンネル名を使用するため、必要に応じて別ソースの候補を選んでください。

API: `/api/health`, `/api/search`, `/api/parse-url`, `/api/playlists/{id}`, `/api/jobs`, `/api/jobs/{id}/cancel`, `/api/assets/{id}`, `/api/storage`, `/api/assistant`。正確なリクエスト・レスポンスは `/docs` と型定義を参照してください。

## 主な操作

- 検索バーへ曲名・アーティスト・アルバム名・YouTube URLを入力。ローカル候補は表記正規化、かな・ローマ字変換、あいまい照合を使用。外部検索は350msデバウンス・キャッシュ・キャンセル・重複抑止。
- 曲の＋でプレイリストへ。メニューから「次に再生」「キュー末尾」「MP3を保存」。再生時も未保存音源をジョブとして取得し、端末保存後に再生します。
- MP3を端末から読み込めます。SHA-256をWorkerで計算し、同じファイルの重複保存を防止します。ファイル名 `アーティスト - 曲名.mp3` を認識します。
- プレイリストは新規・名前変更・削除、曲順のドラッグ / 上下ボタン、複数選択、コピー・移動・結合・重複整理・曲名/アーティスト/ランダム順に対応。
- 「AIスタジオ」に1行1曲、番号付きリスト、Markdown表、CSV、JSON、YouTube URLを貼り付け。候補選択→確定で保存。一般の曲名検索は自動確定しません。文章は引用された曲名を中心に抽出し、自由文は確認対象として表示します。任意の文章を完全に理解する機能ではありません。
- AIアシスタントは関数ツールで操作案を返し、プレビュー後に適用。おすすめは検索語へ展開し、実在の動画との照合を経ます。整理する場合は対象プレイリストを選びます。
- お気に入り、再生履歴、最近追加、再生回数順、検索、JSONバックアップ・復元、プレイリストのテキスト/JSONコピー。
- キューはプレイリストとは独立。再生位置・キュー・音量・リピート等を再読込後に復元し、自動再生はユーザー操作後に開始。次曲を先読みします。再生失敗時は再試行またはスキップ。
- Space: 再生/一時停止、Ctrl+K: 検索、Alt+←/→: 曲送り、Ctrl+Z / Ctrl+Shift+Z: ライブラリ変更のUndo/Redo（30操作、同一セッション）。

## 保存・復旧

ブラウザ: Dexie/IndexedDBにライブラリスナップショットとMP3 Blobを別々に保存します。プレイリストのコピーは曲参照のみを複製し、音声は複製しません。スキーマv1、前回スナップショットの復旧スロット、入力検証付きバックアップ復元を実装しています。復元時は元の接続設定を維持し、外部バックアップのトークンを取り込みません。

バックアップJSONにMP3本体は含まれません。音源は必要に応じて再取得・再読込します。「ダウンロードと保存」から端末とサーバーの容量・ジョブを確認できます。音源削除は音声本体を削除するためUndo対象外で、ローカルファイルは再読込が必要です。端末の空き容量不足・ブラウザデータ消去・OSによる退避で音源を失う可能性があるため、元のMP3は保管してください。設定からブラウザの永続保存を要求できます。

単一ユーザー・単一アクティブタブを想定しています。複数タブ同時編集の競合解決、複数ユーザーのアカウント分離・クラウド同期、データベースの将来版への実移行は未実装です。

サーバー: SQLite WALと原子的ファイル移動。取得ジョブは同時2件、未完了30件、最大3試行、1曲30分・入力音声150MB・処理300秒まで。中断時の一時フォルダを掃除し、再起動で中断したジョブは「失敗・再試行可能」へ復旧。キューは単一プロセスのため**uvicornは1 worker**で起動します。自動無限リトライはしません。

## 公開

### フロントエンド

GitHub Actionsの `Deploy frontend to Pages` を同梱しています。GitHub Repository Settings → Pages → SourceをGitHub Actionsに設定し、必要ならRepository Variable `MUSICPLEASURE_API_URL` にHTTPSのAPI URLを設定します。mainへのマージまたは手動実行でビルド・公開します。PR作成だけではPagesは公開されません。

この作業のプレビューは別途静的公開しています。バックエンド接続は「設定・接続」で指定できます。公開URLのoriginをサーバーの `CORS_ORIGINS` に追加し、接続トークンを設定してください。

### バックエンド

Docker対応のVMやコンテナサービスで `backend/Dockerfile` を実行します。`/data` を永続ボリュームとしてマウント、上表の環境変数を設定、8000番をHTTPSリバースプロキシで公開してください。静的ホスティング・通常の短時間サーバーレス関数ではジョブ処理は動きません。ComposeのローカルAPIポートはループバックへ限定しています。

Bearer認証・origin制限・毎分180リクエスト/クライアント・入力ID検証・固定引数でのプロセス起動・ジョブ/容量制限を含みます。認証トークンは個人インストール用です。不特定多数向けサービスとして公開するには、ユーザー別認可・永続レート制限・監視・クォータの永続化が別途必要です。

## 検証の区分

- Vitest: 取り込み形式・曖昧さ表示・重複・曲順・キュー独立性・Undo/Redo・IndexedDB再接続・バックアップ検証。
- pytest: URL/ID・認証・ページング（55曲のテスト応答）・公式性を捏造しないメタデータ・ジョブ重複/再試行/復旧・実FFmpeg変換/デコード・音声配信/Range・失敗後のAPI応答。
- Playwright: PC / Pixel 7相当 / タブレット相当で作成・復元・オーバーフロー・実テストMP3再生/停止/シーク・接続失敗からの操作をCIで実行します。モバイルエミュレーションは実機検証とは区別します。
- `backend/tests/fixtures/tone.mp3` はFFmpegで生成した8秒の440Hzテスト音で、製品の楽曲データには追加しません。
- 実YouTube・AI通信はキー・ネットワーク・外部サービスに依存します。初期の証明書検証エラーをシステムの信頼済みCA利用で解消し、実YouTube検索25件の取得を確認しました。実YouTube音声の取得は試行した動画で失敗しており、成功は未確認です。AIキー未設定のため実AI応答は未確認です。
- Dockerイメージ（フロントエンド・バックエンド）はGitHub Actions上でビルド成功を確認しました。Android/Windows実機、画面読み上げ、バックグラウンド再生の端末差は未確認です。

## トラブルシューティング

- **ローカルモード / 取得できない**: FastAPIを起動し、API URL・トークン・CORS・HTTPSを確認。`/api/health` でFFmpegとyt-dlpの存在を確認。
- **YouTube取得エラー**: 動画の公開状態・地域・ネットワークを確認。yt-dlpとJavaScript runtime（DockerではNode.js）を更新してください。TLS検証は無効にしません。
- **API割り当て上限**: 過去の結果とローカル音源は使えます。アプリ内のカウンタはプロセスメモリ上で日付更新時にリセットし、Google側の実割り当てとは別です。
- **MP3が消えた**: 端末のブラウザ保存・元ファイルを確認。サーバー保存済みなら同一ジョブを再利用し、端末へ再保存します。
- **再生が始まらない**: ブラウザの自動再生制限により、再生ボタンの操作が必要です。エラー時は再試行・スキップを利用。
- **保存失敗**: 容量整理後、JSONを書き出してください。保存失敗を成功扱いする表示は行いません。
