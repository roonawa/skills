# テストコード

自動で実行するテストケースのコードを置きます。テストケースの書き方は cases/README.md を参照してください。

## 構成

- web/ は Playwright のテストです。package.json と playwright.config.ts は Skill が作ります。
- desktop/ は FlaUI を使う C# のテストプロジェクトです。

## Web のテスト

テストは web/tests/機能名.spec.ts に機能ごとに置きます。テスト名の先頭にケースの TC-ID を付けます。playwright.config.ts は1つだけで、ファイル名の末尾でプロジェクトが分かれます。特性テストは機能名-char.spec.ts（プロジェクト characterization）、認可の表のテストは機能名-authz.spec.ts（authz）、それ以外のテストケースは機能名.spec.ts（cases）です。流すときは --project か、ファイルを指定して絞ります。Playwright の出力（test-results/）は実行のたびに消えるので、残したい診断用のファイルは .qa-scratch/ に置きます。どちらも .gitignore で除外しています。次は書き方の例です。

```
test('TC-detail-003 staff が他人の貸出の詳細 URL を直接開くと 403 になる', async ({ page }) => {
  // 手順と期待結果を書く
});
```

認証済みのセッションを保存する web/.auth/ には Cookie が入るため、.gitignore で除外しています。コミットしないでください。

## Desktop のテスト

テストメソッドの名前かその表示名の先頭に、Web と同じ形でケースの TC-ID を付けます。ビルドの出力（bin/ と obj/）は .gitignore で除外しています。

## 証跡

実行時の証跡は runs/YYYYMMDD-run-id/evidence/TC-ID/ に保存します。保存先と result.md への書き方は runs/README.md を参照してください。
