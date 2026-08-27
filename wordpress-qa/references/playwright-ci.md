# Playwright / CI設計

Playwrightテストとcheck CI workflowの構成ルール。[SKILL.md](../SKILL.md)から参照される詳細版。

## 基本方針

大量のE2Eを作成しない。目的は「重要導線保証」と「公開事故防止」の2点に絞る。

## テスト分類とディレクトリ構成

```
tests/
├ smoke/        # CI対象: トップ表示、主要ページ表示、JSエラーなし
├ security/     # CI対象: wp-login, wp-admin, HTTPS, セキュリティヘッダ
├ seo/          # CI対象: title, description, h1, canonical
├ analytics/    # QA対象
├ form/         # QA対象: 入力、エラー、送信、完了
├ responsive/   # QA対象: Screenshot比較、主要端末確認
└ regression/   # リリース前: 全主要機能、過去不具合、重要導線
```

## テスト命名規則

テスト名は日本語または意味が明確な英語にする。

```ts
// 推奨
test('トップページが正常表示される', async ({ page }) => { ... })

// 禁止
test('test1', async ({ page }) => { ... })
```

## Page Object Model

画面操作はPage Objectへ分離する（例: `pages/ContactPage.ts`, `pages/HomePage.ts`）。

目的: URL変更による大量修正／セレクタ変更による影響拡大／テストコード肥大化を防止する。

## セレクタ優先順位

1. `aria-label`
2. `role`
3. `data-testid`
4. `id`
5. `class`

避けるべきもの: CSS詳細パス、`nth-child`依存

## 実装例

自動化計画で「自動」と判定された項目だけをこのパターンでコード化する。手動判定の項目（内容の妥当性、デザイン品質など）はコードにしない。

### 存在確認型（例: SEOタグ）

内容の妥当性は判定しない。存在有無だけを機械的に確認する。

```ts
// tests/seo/seo-check.spec.ts
import { test, expect } from '@playwright/test';

test.describe('SEO基本タグの存在確認', () => {
  test('titleタグが空でなく存在する', async ({ page }) => {
    await page.goto('/');
    const title = await page.title();
    expect(title.trim().length).toBeGreaterThan(0);
  });

  test('meta descriptionが空でなく存在する', async ({ page }) => {
    await page.goto('/');
    const description = await page.locator('meta[name="description"]').getAttribute('content');
    expect(description?.trim().length ?? 0).toBeGreaterThan(0);
  });

  test('canonicalタグが存在する', async ({ page }) => {
    await page.goto('/');
    const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
    expect(canonical).toBeTruthy();
  });

  test('h1が1つだけ存在する', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toHaveCount(1);
  });
});
```

Security（wp-login/wp-admin/xmlrpc.php露出確認、HTTPSリダイレクト確認）、Analytics（GA4/GTMタグ存在確認）も同じ「存在確認のみ・内容判断はしない」パターンで書く。

### 操作型（例: フォーム）

Page Objectに操作を分離する。

```ts
// pages/ContactPage.ts
import { Page, Locator } from '@playwright/test';

export class ContactPage {
  readonly page: Page;
  readonly nameInput: Locator;
  readonly emailInput: Locator;
  readonly messageInput: Locator;
  readonly submitButton: Locator;
  readonly errorMessage: Locator;

  constructor(page: Page) {
    this.page = page;
    this.nameInput = page.getByLabel('お名前');
    this.emailInput = page.getByLabel('メールアドレス');
    this.messageInput = page.getByLabel('お問い合わせ内容');
    this.submitButton = page.getByRole('button', { name: '送信' });
    this.errorMessage = page.locator('[role="alert"]');
  }

  async goto() {
    await this.page.goto('/contact');
  }

  async submitEmpty() {
    await this.submitButton.click();
  }
}
```

```ts
// tests/form/contact-form.spec.ts
import { test, expect } from '@playwright/test';
import { ContactPage } from '../../pages/ContactPage';

test.describe('お問い合わせフォーム', () => {
  test('主要な入力項目が表示される', async ({ page }) => {
    const contact = new ContactPage(page);
    await contact.goto();
    await expect(contact.nameInput).toBeVisible();
    await expect(contact.emailInput).toBeVisible();
    await expect(contact.messageInput).toBeVisible();
    await expect(contact.submitButton).toBeVisible();
  });

  test('未入力で送信するとバリデーションエラーが表示される', async ({ page }) => {
    const contact = new ContactPage(page);
    await contact.goto();
    await contact.submitEmpty();
    await expect(contact.errorMessage).toBeVisible();
  });
});
```

このパターンの適用範囲: 表示確認・バリデーション確認・正常送信〜完了画面遷移まで。メール受信確認は環境依存のため対象外（手動）。reCAPTCHA有効時、送信成功判定はBot判定に依存するため自動テストのpass/fail条件に使わない（表示・バリデーションまでを自動化範囲とし、実送信結果の妥当性は手動確認へ回す）。

### ページ表示・ナビゲーション（smoke）

```ts
// tests/smoke/page-display.spec.ts
import { test, expect } from '@playwright/test';

const PAGES = ['/', '/company', '/service']; // SKILL.md Inputのpagesから取得

for (const path of PAGES) {
  test(`${path} が正常表示される`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    const response = await page.goto(path);
    expect(response?.status()).toBeLessThan(400);
    expect(errors).toEqual([]);

    const images = page.locator('img');
    const count = await images.count();
    for (let i = 0; i < count; i++) {
      const naturalWidth = await images.nth(i).evaluate((img: HTMLImageElement) => img.naturalWidth);
      expect(naturalWidth).toBeGreaterThan(0);
    }
  });
}
```

```ts
// tests/smoke/navigation.spec.ts
import { test, expect } from '@playwright/test';

test('グローバルナビ・フッターのリンクがリンク切れしていない', async ({ page }) => {
  await page.goto('/');
  const hrefs = await page.locator('header a, footer a').evaluateAll(
    (links) => links.map((l) => (l as HTMLAnchorElement).href)
  );

  for (const href of new Set(hrefs)) {
    if (!href.startsWith('http')) continue;
    const response = await page.request.get(href);
    expect(response.status(), href).toBeLessThan(400);
  }
});
```

### Security

判定基準は決め打ちにせず、SKILL.md Inputの`security.wp_login.expected` / `security.admin.expected`（`blocked` | `allowed`）をそのまま使う。

```ts
// tests/security/security-check.spec.ts
import { test, expect } from '@playwright/test';

// Inputのsecurity.wp_login.expected / security.admin.expected に合わせて調整する
const TARGETS: Array<{ path: string; expected: 'blocked' | 'allowed' }> = [
  { path: '/wp-login.php', expected: 'blocked' },
  { path: '/wp-admin/', expected: 'blocked' },
];

for (const { path, expected } of TARGETS) {
  test(`${path} が期待どおりの公開状態(${expected})である`, async ({ request }) => {
    const response = await request.get(path, { maxRedirects: 0 });
    if (expected === 'blocked') {
      expect([301, 302, 403, 404]).toContain(response.status());
    } else {
      expect(response.status()).toBe(200);
    }
  });
}

test('xmlrpc.php が無効化されている', async ({ request }) => {
  const response = await request.post('/xmlrpc.php');
  expect(response.status()).not.toBe(200);
});

test('HTTPからHTTPSへリダイレクトされる', async ({ request }) => {
  const response = await request.get('http://SITE_ORIGIN/', { maxRedirects: 0 });
  expect([301, 302, 308]).toContain(response.status());
  expect(response.headers()['location']).toMatch(/^https:/);
});
```

`SITE_ORIGIN`はプロジェクトごとのドメインに置き換える（推測で仮ドメインを作らない。SKILL.md Inputの`project.url`を使う）。

### Analytics

```ts
// tests/analytics/ga4-check.spec.ts
import { test, expect } from '@playwright/test';

test('GA4タグが読み込まれている', async ({ page }) => {
  const gaRequests: string[] = [];
  page.on('request', (req) => {
    if (/google-analytics\.com\/g\/collect|googletagmanager\.com\/gtag\/js/.test(req.url())) {
      gaRequests.push(req.url());
    }
  });

  await page.goto('/');
  await page.waitForTimeout(1000); // GA4は非同期送信のため少し待つ
  expect(gaRequests.length).toBeGreaterThan(0);
});
```

## CI Workflow

### 基本構成

```yaml
name: QA Check
on:
  pull_request:
  push:
    branches:
      - main
```

### 実行内容

1. Install: `npm ci`
2. Static Check: lint / typecheck / build
3. QA Smoke: Playwright smoke / security / seo

### CI対象

Build, Lint, Syntax Check, Broken Link, HTTP Status, JavaScript Error, SEO基本確認, Security基本確認

### CI対象外（QA工程で実施）

Visual Regression, UX確認, デザインレビュー, 誤字脱字

### CI失敗条件

Build Failure / Console Error / Critical URL Error / Required Meta Missing / Security Check Failure

### CI失敗時レポート形式

```md
# CI Failure Report

## Failed Test

## Impact

## Recommended Action

## Priority
```

## Regression Test

目的: 修正による既存機能破壊を検出する。

実行タイミング: 大規模修正後／リリース前／重要機能変更後

対象: 問い合わせ／主要導線／SEO／Security／Analytics
