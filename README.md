# MusicPleasure v2.1 — Invidious-only Music PWA

音楽とYouTubeの歌ってみたを、**Invidious API専用**で検索・音声再生するReact/TypeScript/Vite PWAです。

## 再生基盤

- 最優先接続先はAndroid実機で再生成功の報告があった `https://yt.chocolatemoo53.com`。
- 代替候補は `https://eu.yt.chocolatemoo53.com`、`https://invidious.nerdvpn.de`、`https://inv.nadeko.net`、`https://invidious.tiekoetter.com`。
- `/api/v1/search`、`/api/v1/videos/:id`、`/api/v1/playlists/:id`、`/api/v1/channels/:id/videos`、`/api/v1/search/suggestions` を利用。
- `adaptiveFormats` の音声を優先し、利用可能な場合は音声入り `formatStreams` を代替として試します。
- 複数インスタンスの評価、切り替え、失敗の一時除外、音声再生成功の独立記録に対応。
- YouTube IFrameとMP3変換サーバーは使用しません。

## 機能

- 楽曲・歌ってみた・チャンネル検索、URL登録、検索候補
- キュー・連続再生・シャッフル・リピート・位置保存・Media Session
- プレイリスト作成・編集・複製・結合・一括操作・Undo / Redo
- 関連動画・検索・お気に入り・履歴を利用した6モード推薦と無限ラジオ
- コピー＆ペーストの一括登録と候補確認、YouTubeプレイリスト取り込み
- IndexedDB、JSONバックアップ、オフラインのライブラリ閲覧、PWA更新
- 従来の保存済みライブラリを保護し、旧再生エンジンの設定のみを移行

## 開発

    npm ci
    npm run dev
    npm test
    npm run build
    npx playwright install --with-deps chromium
    npm run test:e2e

公開先: https://totoro0419.github.io/musicpleasure/

## 検証と既知の制約

検索APIの成功や音声URLの取得成功は、実際の音声再生成功を意味しません。動画ごとの取得拒否、HTTP 403、CORS、音声形式、公開インスタンスの停止によって再生できないことがあります。すべてのYouTube投稿の再生は保証しません。

単体・模擬音声テストと、モックなしの実サービス試験 `tests/live.spec.ts` は区別します。実サービス試験では再生位置の進行、シーク、曲終了、連続再生、無限ラジオを独立して確認します。

API仕様: https://docs.invidious.io/api/
公式インスタンス一覧: https://docs.invidious.io/instances/
