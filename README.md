# MusicPleasure v2.0

YouTube動画IDをキーにした、ログイン不要の音楽PWA。React / TypeScript / Vite。

- Piped検索・音声取得、複数インスタンスの評価・期限付きの利用停止・切り替え
- ブラウザの対応形式から音声を選択し、音声専用ストリームがない場合はPipedの返す音声入りMP4を利用（YouTube IFrameへの切り替えなし）
- キュー、連続再生、シャッフル、3種類のリピート、再開位置、Media Session
- プレイリスト作成・編集・複製・結合、一括操作、仮想リスト、Undo / Redo
- 関連動画・検索・好みの履歴を使った6モードのローカル推薦・無限ラジオ
- コピペ一括登録、候補確認、中断・再開、YouTubeプレイリストのページ単位プレビュー
- 日本語のルール式操作（抽出・削除・並べ替え・作成・結合）、変更プレビュー
- IndexedDB、JSONバックアップ、形式検証、スキーマ移行、オフライン閲覧、PWA更新通知

## 開発

```sh
npm ci
npm run dev
npm test
npm run build
npx playwright install --with-deps chromium
npm run test:e2e
```

公開先: https://totoro0419.github.io/musicpleasure/

`main`へのpushでGitHub Actionsがテスト・ビルド後にPagesへ公開します。Pagesの公開元はGitHub Actionsを使用します。`backup/pre-v2-reset-2026-11-09` は保持しています。Curiveoは参照のみで変更していません。

## 実装上の境界

Pipedの候補一覧はTeamPipedの公式資料から取得します。一覧掲載・API応答成功だけでは音声再生可能と判定しません。設定にAPI結果と実音声開始の成功記録を分けて表示します。公開インスタンスの稼働・YouTube側の制限はアプリで保証できません。Piped検索が全滅すると、曲名検索・新しい推薦の取得は失敗を表示します。動画URLもPipedで取得します。YouTube公式プレーヤーへは切り替えません。

推薦は曲名・投稿者・関連動画・ユーザー操作を使ったルール処理です。音色・声質の解析や外部LLMの利用は行いません。自然言語の操作は画面に示した文型に対応し、任意の日本語を理解する生成AIではありません。

音声データや一時的なストリームURLは長期保存しません。オフラインではライブラリ閲覧のみ。バックグラウンド・ロック画面・Bluetooth操作はOSとブラウザの制限を受け。

## 検証

`npm test`はモデル・推薦・保存と、模擬音声による競合処理を検証します。`tests/app.spec.ts`はモックAPIで画面操作と3種類の端末サイズを検証します。これらの成功はPiped/YouTubeの実再生成功を意味しません。`tests/live.spec.ts`はモックなしで公開環境の検索・再生・シーク・曲終了による次曲・ラジオ補充を試行し、観測結果を記録します。

公式資料: [Piped API](https://docs.piped.video/docs/api-documentation/) / [OpenAPI](https://github.com/TeamPiped/OpenAPI) / [公開候補一覧](https://github.com/TeamPiped/documentation/blob/main/content/docs/public-instances/index.md)

## 取得失敗時の連続再生

取得拒否・形式非対応・音声URLエラーの曲は一定時間だけ自動候補から除外し、キューの後ろを順に確認します。プレイリストから曲は削除しません。同じ動画を一回の確認で無限に再試行せず、全曲を確認しても再生できない場合に停止します。ブラウザの操作要求は「曲の失敗」としてスキップしません。停止・一時停止・別曲の選択は進行中の自動送りを取り消します。

次曲とラジオ候補は、音声を鳴らさずにデータの読み込み・デコードを先行確認します。先行確認は実再生成功と別に記録し、実際に再生位置が進んだ接続先だけを音声成功として評価します。ラジオは先行確認できた候補だけをキューへ追加します。

設定の診断欄に、動画ID・接続先・失敗段階・HTTP状態・原因分類・一時除外の期限を記録します。ブラウザではネットワークとCORSを断定できない場合があり、その場合は区別不能として表示します。

実サービス試験は `tests/fixtures/piped-tracks.json` の10投稿（歌ってみた5投稿）をPC・Androidタブレット相当で検証し、曲別の結果をActionsのJSON成果物へ保存します。実再生3曲・連続3曲・ラジオ継続を満たさない場合、この実サービス合格判定は失敗します。単体試験の成功でこの判定を置き換えません。
