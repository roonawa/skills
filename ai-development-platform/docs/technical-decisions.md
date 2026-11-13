# 技術選定（2026-11-10）
作業先は既存の個人 Skill 集で、未コミット変更もある。配布単位を子ディレクトリにまとめる。GitHub Actions の入口は親の .github/workflows に置き、対象パスで絞る。

- Claude Code のプロジェクト Skill を第一の配布先にする。Codex は同じ Markdown をプロジェクトの .agents/skills から発見する。ローカルで確認した Codex CLI は 0.167.0-alpha.3.2。[Claude Code](https://code.claude.com/docs/en/skills) / [OpenAI Docs](https://learn.chatgpt.com/docs/build-skills)
- 共通規約の原本は AGENTS.md。Claude Code には CLAUDE.md の import から渡す。[OpenAI Docs](https://developers.openai.com/codex/guides/agents-md) / [Claude Code memory](https://code.claude.com/docs/en/memory)
- 標準の name、description と文字列の metadata.version を採用する。汎用 YAML 解釈には yaml を利用する。配布物は単一 Markdown だけの社内プロファイルに限定する。skills-ref は標準形式の検査候補。プロジェクト固有の版・配布後の差異は CLI が検査する。[Agent Skills 仕様](https://agentskills.io/specification)
- 単一 npm パッケージと strict TypeScript、Node 標準テストを採用する。現時点で独立公開する利用者がないため、5パッケージへの分割と pnpm workspace を見送る。品質検査は npm scripts と CI で起動する。コンテキスト探索と対話はホストが担当する。
- Unity Test Framework 1.4 系にはバッチテストの入口がある。コミュニティの Unity MCP は Editor とサーバーを接続する追加構成である。採用前に対象 Editor・パッケージ・ライセンス・通信先を固定し、隔離プロジェクトで確認する。今回の実機検証対象外。[Unity CLI](https://docs.unity3d.com/Packages/com.unity.test-framework@1.4/manual/reference-command-line.html) / [Unity MCP](https://github.com/CoplayDev/unity-mcp)
- 新規 MCP、外部 Registry、自動デプロイ、独自の AI 実行ループは初期導入しない。外部コンテンツは資料として扱う。認証情報、入力全文、ファイル内容を診断ログに出さない。

## Phase 3 の検査方式

React の本番ビルドには Vite、静的検査には TypeScript と Biome を採用した。サンプルの操作は jsdom と Node の標準テストで確認する。Adapter が呼び出す script 名は固定し、実装は生成先の package.json で管理する。依存の導入は独立した npm ci とし、init や verify を実行してもプロジェクトコードは起動しない。[Vite](https://vite.dev/guide/) / [Biome CLI](https://biomejs.dev/reference/cli/)

Unity は Editor 2022.3.62f1 と Test Framework 1.4.6 を初回の実機検証対象に選んだ。実機で確認する際は EditMode・PlayMode の各実行に -runTests、-testPlatform、-testResults を指定し、終了コード・今回生成された XML・ログを突き合わせる。現在の CLI は設定照合までを実行する。[Unity Test Framework CLI](https://docs.unity3d.com/Packages/com.unity.test-framework@1.4/manual/reference-command-line.html)
