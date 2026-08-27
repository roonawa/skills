# 出力フォーマット集

[SKILL.md](../SKILL.md)のWorkflowで生成する成果物のテンプレート。すべて単体で開けるHTMLファイル（`.md`ではなく`.html`）として出力する。

各ファイルの`<head>`には共通スタイルを埋め込む。テンプレート間で使い回すこと。

```html
<style>
  body { font-family: -apple-system, "Segoe UI", "Hiragino Kaku Gothic ProN", sans-serif; max-width: 900px; margin: 2rem auto; padding: 0 1rem; line-height: 1.6; color: #1a1a1a; }
  h1 { border-bottom: 3px solid #2563eb; padding-bottom: .5rem; }
  h2 { border-left: 4px solid #2563eb; padding-left: .5rem; margin-top: 2rem; }
  table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
  th, td { border: 1px solid #ccc; padding: .5rem .75rem; text-align: left; }
  th { background: #f1f5f9; }
  .badge { display: inline-block; padding: .1rem .6rem; border-radius: 999px; font-size: .85rem; font-weight: 600; }
  .critical { background: #fee2e2; color: #991b1b; }
  .high { background: #ffedd5; color: #9a3412; }
  .medium { background: #fef9c3; color: #854d0e; }
  .low { background: #e5e7eb; color: #374151; }
  ul.checklist { list-style: none; padding-left: 0; }
  ul.checklist li { margin: .4rem 0; }
  .tag { font-size: .8rem; color: #64748b; margin-left: .4rem; }
</style>
```

## 1. QA分析結果 (qa-analysis.html)

```html
<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<title>QA分析結果 - {{project_name}}</title>
<style>/* 共通スタイル（上記）をここに挿入 */</style>
</head>
<body>
<h1>QA分析結果</h1>

<h2>サイト概要</h2>
<table>
  <tr><th>サイト種別</th><td>{{site_type}}</td></tr>
  <tr><th>CMS</th><td>{{cms}}</td></tr>
  <tr><th>ページ数</th><td>{{page_count}}</td></tr>
  <tr><th>主要機能</th><td>{{features}}</td></tr>
</table>

<h2>リスク分析</h2>
<table>
  <tr><th>重要度</th><th>内容</th></tr>
  <tr><td><span class="badge critical">Critical</span></td><td>{{critical_items}}</td></tr>
  <tr><td><span class="badge high">High</span></td><td>{{high_items}}</td></tr>
  <tr><td><span class="badge medium">Medium</span></td><td>{{medium_items}}</td></tr>
  <tr><td><span class="badge low">Low</span></td><td>{{low_items}}</td></tr>
</table>

<h2>推奨テスト戦略</h2>
<table>
  <tr><th>自動化</th><td>{{automated}}</td></tr>
  <tr><th>手動確認</th><td>{{manual}}</td></tr>
  <tr><th>CI対象</th><td>{{ci_targets}}</td></tr>
  <tr><th>リリース前確認</th><td>{{release_check}}</td></tr>
</table>
</body>
</html>
```

## 2. QAチェックリスト (qa-checklist-output.html)

カテゴリ単位（ページ表示／フォーム／ナビゲーション／SEO／Security／Analytics／reCAPTCHA／Responsive／Accessibility／運用）で作成する。実際のチェック操作は不要（配布・記録用）なため`<input type="checkbox">`は`disabled`にする。

SKILL.mdの最終出力ルール（自動化対象／手動対象／CI対象／Playwright対象を明記する）を満たすため、各項目の末尾に`<span class="tag">`で実施方法（自動／手動）と実施場所（CI／QA／対象外）を付記する。カテゴリ・項目名はqa-checklist.mdの一覧、自動化可否はSKILL.mdのQuick Referenceを元に決める。

```html
<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<title>QAチェックリスト - {{project_name}}</title>
<style>/* 共通スタイル（上記）をここに挿入 */</style>
</head>
<body>
<h1>QAチェックリスト</h1>

<h2>ページ表示</h2>
<ul class="checklist">
  <li><input type="checkbox" disabled> トップページ表示確認 <span class="tag">自動／CI</span></li>
  <li><input type="checkbox" disabled> 下層ページ表示確認 <span class="tag">自動／CI</span></li>
  <li><input type="checkbox" disabled> JavaScriptエラー確認 <span class="tag">自動／CI</span></li>
  <li><input type="checkbox" disabled> 見た目の品質確認 <span class="tag">手動／QA</span></li>
</ul>

<h2>SEO</h2>
<ul class="checklist">
  <li><input type="checkbox" disabled> title確認（存在） <span class="tag">自動／CI</span></li>
  <li><input type="checkbox" disabled> description確認（存在） <span class="tag">自動／CI</span></li>
  <li><input type="checkbox" disabled> canonical確認（存在） <span class="tag">自動／CI</span></li>
  <li><input type="checkbox" disabled> 内容の妥当性確認 <span class="tag">手動／QA</span></li>
</ul>

<h2>Security</h2>
<ul class="checklist">
  <li><input type="checkbox" disabled> wp-login確認 <span class="tag">自動／CI</span></li>
  <li><input type="checkbox" disabled> wp-admin確認 <span class="tag">自動／CI</span></li>
</ul>
</body>
</html>
```

## 3. 自動化計画 (automation-plan.html)

```html
<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<title>自動化計画 - {{project_name}}</title>
<style>/* 共通スタイル（上記）をここに挿入 */</style>
</head>
<body>
<h1>自動化計画</h1>
<table>
  <tr><th>項目</th><th>方法</th><th>実施場所</th></tr>
  <tr><td>title確認</td><td>Playwright</td><td>CI</td></tr>
  <tr><td>GA確認</td><td>Playwright</td><td>CI</td></tr>
  <tr><td>フォーム送信</td><td>Playwright</td><td>QA</td></tr>
  <tr><td>デザイン確認</td><td>手動</td><td>QA</td></tr>
</table>
</body>
</html>
```

## 4. 手動テスト仕様 (manual-test-spec.html)

```html
<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<title>Manual Test Specification - {{project_name}}</title>
<style>/* 共通スタイル（上記）をここに挿入 */</style>
</head>
<body>
<h1>Manual Test Specification</h1>

<h2>デザイン</h2>
<p>確認: レイアウト／余白／文字サイズ</p>

<h2>文言</h2>
<p>確認: 誤字／表記揺れ</p>

<h2>UX</h2>
<p>確認: 操作性／導線</p>
</body>
</html>
```

## 5. 不具合報告（Bug Report） (bug-report.html)

```html
<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<title>Bug Report - {{bug_title}}</title>
<style>/* 共通スタイル（上記）をここに挿入 */</style>
</head>
<body>
<h1>Bug Report</h1>

<h2>Title</h2>
<p>{{bug_title}}</p>

<h2>Severity</h2>
<p><span class="badge {{severity_class}}">{{severity}}</span></p>

<h2>Environment</h2>
<table>
  <tr><th>Browser</th><td>{{browser}}</td></tr>
  <tr><th>Device</th><td>{{device}}</td></tr>
</table>

<h2>Steps</h2>
<ol>
  <li>{{step1}}</li>
  <li>{{step2}}</li>
  <li>{{step3}}</li>
</ol>

<h2>Expected</h2>
<p>{{expected}}</p>

<h2>Actual</h2>
<p>{{actual}}</p>

<h2>Evidence</h2>
<p>Screenshot: {{screenshot}}</p>
<p>Log: {{log}}</p>
</body>
</html>
```

Severity判定基準（`severity_class`にはbadgeクラス名 `critical`/`high`/`medium`/`low` を入れる）:

| Severity | 対象 | 対応 |
|---|---|---|
| Critical | サイト閲覧不可、個人情報漏洩、フォーム利用不可 | 即時修正 |
| High | 主要機能不具合、SEO重大問題、表示崩れ | リリース前修正 |
| Medium | 一部表示問題、軽微なUX問題 | 計画修正 |
| Low | 文言、軽微なデザイン差異 | 改善管理 |

## 6. リリースチェックリスト (release-checklist.html)

```html
<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<title>Release Checklist - {{project_name}}</title>
<style>/* 共通スタイル（上記）をここに挿入 */</style>
</head>
<body>
<h1>Release Checklist</h1>

<h2>CI</h2>
<ul class="checklist">
  <li><input type="checkbox" disabled> Build成功</li>
  <li><input type="checkbox" disabled> Test成功</li>
</ul>

<h2>Security</h2>
<ul class="checklist">
  <li><input type="checkbox" disabled> wp-login確認</li>
  <li><input type="checkbox" disabled> HTTPS確認</li>
</ul>

<h2>SEO</h2>
<ul class="checklist">
  <li><input type="checkbox" disabled> title確認</li>
  <li><input type="checkbox" disabled> description確認</li>
</ul>

<h2>Analytics</h2>
<ul class="checklist">
  <li><input type="checkbox" disabled> GA確認</li>
</ul>

<h2>QA</h2>
<ul class="checklist">
  <li><input type="checkbox" disabled> 手動確認完了</li>
  <li><input type="checkbox" disabled> 不具合対応完了</li>
</ul>
</body>
</html>
```
