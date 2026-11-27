# 無人実行ランナーの配置の見本

`aidev` の無人実行ランナー（`dist/runner.js --once`）を Gitea Actions で動かすための見本です。設計は [docs/autonomous-runner-design.md](../../docs/autonomous-runner-design.md)、ランナーの動きは [README](../../README.md) の「ランナーの本体（段階2）」を見てください。

| ファイル | 置き場所 |
|---|---|
| `.gitea/workflows/aidev-runner.yml` | ランナー専用のリポジトリ（例: `aidev-runner`）の同じ場所 |
| `runner.json` | 同じリポジトリの直下。秘密情報は書かない |

## 前提（ランナーのホスト）

- act_runner をホストで動かす（コンテナで動かすと、実行記録の stateDir がジョブごとに消える）。ラベルは `aidev` だけにし、`capacity: 1` にする
- Node.js 22.15 以上（`--use-system-ca` を使うため）、git、Claude Code（`claude`）が入っている
- aidev（ai-development-platform）を決まった場所に置き、`npm ci` と `npm run build` を済ませる。その場所を Gitea のリポジトリ変数 `AIDEV_HOME` に入れる
- `runner.json` の `stateDir` と `workDir` は、ランナーのホスト上の絶対パス。ジョブの作業フォルダの外に置く。Windows のホストなら `C:/aidev-runner/state` のように書く

## Gitea に登録するもの

| 種類 | 名前 | 中身 |
|---|---|---|
| secrets | `CHUB_TOKEN` | C-HUB のキー。`task-manager:read` だけ（通知するなら `sugar-forum:digest` も）。書き込みの権限は付けない |
| secrets | `GITEA_TOKEN` | AI 専用アカウントのトークン。対象リポジトリへの書き込みだけ |
| secrets | `ANTHROPIC_API_KEY` | Claude Code の認証。方式は設計書8章で決める |
| 変数 | `AIDEV_HOME` | aidev を置いた場所 |

対象リポジトリの側では、main を保護ブランチにし、AI 専用アカウントからの直接の push を禁じる。`aidev/*` ブランチへの push や PR で、secrets を使うワークフローが動かないようにする。対象リポジトリには aidev の Skill（aidev-implementation・aidev-testing・aidev-repair-workflow・aidev-code-review）を入れておく。

## 最初の起動

1. Gitea のランナー専用リポジトリの「Actions」から、`aidev-runner` を手動で実行する（`workflow_dispatch`）
2. 最初は C-HUB の対象ボードに着手できるタスクが無い状態で実行し、「前提の確認」と、C-HUB・Gitea への接続（`ran: null` で終わる）を確かめる
3. 次に、試行用のタスク1件で実行し、PR ができることを確かめる（2026-11-27 に開発者の PC で確かめた手順と同じ）
4. 段階3に進むときに、ワークフローの `schedule` のコメントを外す

## 未確認のこと（設計書8章）

- ランナーの OS。見本は bash で書いている（Windows でも Git for Windows の bash を使う前提）
- `actions/checkout@v4` をランナーが取得できるか。できなければ、ランナーの設定を git で取り出す手順に置き換える
- Gitea 1.23.8 の Actions で `schedule`・`timeout-minutes`・secrets・変数が想定どおり動くか
- Claude Code の認証方式
