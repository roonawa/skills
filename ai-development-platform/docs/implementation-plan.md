# 実装計画
1. 空の一時ディレクトリから CLI を呼ぶ受け入れテストを書く。init、skill list/add/validate、verify、doctor を JSON と終了コードで検証する。
2. skills/core の検証用 Skill 一件を原本にし、Registry で名前・説明・版を読む。フォルダ名との不一致や不正な版を単体テストで拒否する。
3. core テンプレートで版付き設定とホスト指示を生成する。全書込予定を先に検査し、異なる既存ファイルを保護する。途中停止後は同じコマンドで不足分を補う。
4. 配置済み Skill の二つのコピーと原本を照合する。dry-run、パス逸脱、競合、リンク、片側欠損をテストする。
5. strict ビルドと CLI テストを Windows で実行し、同じコマンドを Linux・macOS・Windows の CI に登録する。
