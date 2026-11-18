# フォーム認証でのセッションの取得

アプリ自身がユーザー名とパスワードのフォームを持ち、送信するとアプリがセッションの Cookie を発行する方式で読む。ログインの判定の基準とセッションの確認は SKILL.md にあり、ここでは Playwright での書き方と、フォーム認証で起きやすい落とし穴を扱う。

## 構成

`automation/web/` に次を置く。ファイル名は例で、QA リポジトリにすでに決まりがあればそれに従う。

- `playwright.config.ts`：`setup` のプロジェクトと、それに依存するテストのプロジェクト
- `tests/auth.setup.ts`：ロールごとにログインし、storageState を保存する
- `tests/session.ts`：保存したセッションが使えるかを確かめる関数。setup と、後続のテストの前の確認の両方で使う
- `tests/auth-path.ts`：storageState のファイルの場所を決める関数。setup と設定の両方で使う

ロール、環境変数の名前、入口の URL、ログインが必要なページは、プロファイルから読み取って setup に渡す。コードに環境変数の値を書かない。

## ファイルの場所

storageState のパスを `'.auth/staff.json'` のような相対パスで書くと、Playwright を起動したディレクトリを基準に解決される。QA リポジトリのルートから `npx playwright test -c automation/web` で流すと、ファイルはルートの `.auth/` にでき、`.gitignore` の `automation/web/.auth/` で除外されない。場所は設定ファイルの位置から組み立てる。

```ts
// automation/web/tests/auth-path.ts
import path from 'node:path';

/** automation/web/.auth/<role>.json。環境を分けるときは automation/web/.auth/<environment>/<role>.json */
export const authFile = (role: string, environment?: string) =>
  path.join(__dirname, '..', '.auth', ...(environment ? [environment] : []), `${role}.json`);
```

`__dirname` は、Playwright が TypeScript を CommonJS として読み込む既定の構成で使える。`automation/web/package.json` に `"type": "module"` を書いた構成では、`path.dirname(fileURLToPath(import.meta.url))` に置き換える。

## 設定の例

```ts
// automation/web/playwright.config.ts
import { defineConfig } from '@playwright/test';
import { authFile } from './tests/auth-path';

export default defineConfig({
  testDir: './tests',
  use: { baseURL: process.env.QA_BASE_URL },  // プロファイルの environments の url を渡す
  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
      timeout: 60_000,
      // トレースは入力した値（パスワード）と通信（ログインの POST、Set-Cookie）を、動画とスクリーンショットは画面を記録する
      use: { trace: 'off', video: 'off', screenshot: 'off' },
    },
    { name: 'staff', dependencies: ['setup'], use: { storageState: authFile('staff') } },
  ],
});
```

setup のプロジェクトでは、トレース、動画、失敗時のスクリーンショットを切る。全体の `use` で `trace: 'on'` や `'retain-on-failure'` にしている QA リポジトリでも、setup だけはプロジェクトの `use` で上書きする。setup のトレースや動画は証跡にしない。失敗の診断には、setup のコードが取る画面の本文のテキストを使う。

`QA_BASE_URL` のような実行時の値は、作業者がシェルで設定するか、setup が読むプロファイルから決める。どちらにするかは QA リポジトリの決まりに合わせる。ロールが多いときは、プロジェクトをロールごとに作るより、テストの中で `test.use({ storageState: authFile('<role>') })` を指定するほうが見通しがよい。

## setup の例

```ts
// automation/web/tests/auth.setup.ts
import { test as setup } from '@playwright/test';
import { authFile } from './auth-path';
import { assertSignedIn } from './session';

// プロファイルの roles と login から作る。値ではなく環境変数の名前を持つ
const roles = [
  { name: 'staff', userEnv: 'EXAMPLE_STAFF_USER', passwordEnv: 'EXAMPLE_STAFF_PASSWORD' },
];
const loginPath = '/login';      // login.entry_url のパス
const protectedPath = '/items';  // プロファイルの到達手順にある、ログインが必要なページ
const waitMs = 30_000;

for (const role of roles) {
  setup(`${role.name} のセッションを作る`, async ({ page, browser, baseURL }) => {
    const user = process.env[role.userEnv];
    const password = process.env[role.passwordEnv];
    if (!user || !password) throw new Error(`環境変数 ${role.userEnv} と ${role.passwordEnv} を設定してください`);

    await page.goto(loginPath);
    const appOrigin = new URL(page.url()).origin;
    await page.getByLabel('ユーザー名').fill(user);
    await page.getByLabel('パスワード').fill(password);
    await page.getByRole('button', { name: 'ログイン' }).click();

    // ログイン画面から離れるか、エラーの表示が出るかの早いほうを待つ。どちらも起きなければ timeout
    const left = page.waitForURL(u => u.pathname !== loginPath, { timeout: waitMs }).then(() => 'left' as const, () => 'timeout' as const);
    const shown = page.getByRole('alert').waitFor({ state: 'visible', timeout: waitMs }).then(() => 'error' as const, () => 'timeout' as const);
    const outcome = await Promise.race([left, shown]);

    if (outcome !== 'left') {
      await page.getByLabel('パスワード').fill('').catch(() => {});  // 診断の前に、入力した値を画面から消す
      const text = (await page.locator('body').innerText()).slice(0, 500);
      if (outcome === 'error') throw new Error(`${role.name}: アプリで拒否（エラーの表示あり）。資格情報かアカウントの状態を確かめる。画面: ${text}`);
      throw new Error(`${role.name}: 着地点が不明（${waitMs / 1000} 秒待っても ${new URL(page.url()).pathname} のまま、エラーの表示なし）。画面: ${text}`);
    }
    const landed = new URL(page.url());
    if (landed.origin !== appOrigin || landed.pathname === '/') {
      throw new Error(`${role.name}: 着地点が不明（${landed.origin}${landed.pathname}）`);
    }

    const file = authFile(role.name);
    await page.context().storageState({ path: file });
    await assertSignedIn(browser, baseURL, file, protectedPath, loginPath);
  });
}
```

`waitForLoadState()` で待ってから URL を見る書き方にしない。フォームを XHR で送る画面では読み込みがすぐに終わり、まだログイン画面の URL のまま判定して、成功するはずのログインを「アプリで拒否」と誤る。エラーの表示の探し方（例では `role="alert"`）は、対象のアプリで失敗したときに実際に出る要素に合わせる。エラーを同じ URL のまま出すアプリも、`/login?error` のように別のクエリで出すアプリもあるため、URL ではなく表示で拒否を判定する。

```ts
// automation/web/tests/session.ts
import { expect, type Browser } from '@playwright/test';

/** 保存した storageState でログインが必要なページを開き、ログイン画面へ戻されないことを確かめる。 */
export async function assertSignedIn(browser: Browser, baseURL: string | undefined, statePath: string | undefined, protectedPath: string, loginPath: string) {
  const context = await browser.newContext({ baseURL, storageState: statePath });
  try {
    const page = await context.newPage();
    await page.goto(protectedPath);
    expect(new URL(page.url()).pathname, 'ログイン画面へリダイレクトされた。セッションが切れているか、保存に失敗している').not.toBe(loginPath);
    await expect(page.getByRole('link', { name: 'ログアウト' })).toBeVisible();
  } finally {
    await context.close();
  }
}
```

`browser.newContext` で作るコンテキストには設定の `baseURL` が引き継がれないので、例のように `baseURL` のフィクスチャを渡す。新しいコンテキストで開くのは、保存したファイルだけでログイン状態が再現できるかを見るためで、ログインに使ったページのままでは確認にならない。着地点がルート（`/`）だけのときを不明としているのは、ルートがログイン画面へ転送するだけのアプリもあるためで、ルートが本来の着地点のアプリならこの条件を外す。ログインが必要な要素（例ではログアウトのリンク）は、対象のアプリで実際にログイン中だけ出るものを選ぶ。どのページにも出る要素を選ぶと、確認が何も検出しない。

確認が検出できることは、`assertSignedIn(browser, baseURL, undefined, ...)` を一度呼び、ログイン画面へのリダイレクトとして失敗することで確かめる。

## 落とし穴

- ログインの失敗を、HTTP の状態コードだけで判定しない。失敗してもログイン画面を 200 で返すアプリも、401 で返すアプリもある。着地点と画面で判定する
- 送信の後に `waitForURL` で一覧などの特定のパスを待つと、失敗したときにタイムアウトの例外になり、どの判定かが分からない。上の例のように、ログイン画面から離れることとエラーの表示が出ることの早いほうを待ち、その後で判定する
- ログインの後の遷移先が、直前に開こうとしたページ（リターン URL）で変わるアプリがある。入口は毎回同じ URL から始める
- 入力欄はラベルやロールで探す。CSS のクラス名はデザインの変更で変わりやすい。ラベルがない画面では、`name` 属性や `data-testid` を使う
- ユーザー名とパスワードが2段階に分かれた画面では、2段目の入力欄が現れるのを待ってから入力する。どちらの段のボタンも同じ表示名のことがある
- CSRF トークンを hidden の入力欄で持つフォームは、ブラウザで送信すれば自動で付く。`request` で直接 POST する書き方にすると、トークンの取得を自分で書く必要がある
- 「ログイン状態を保持する」の選択肢は、テストではプロファイルや作業者の指示がなければ触らない。選ぶとセッションの寿命が変わり、期限切れの検出の前提がずれる
- CAPTCHA が出たら自動で突破しようとせず、作業者に伝えて止める。検証環境で無効にできるかは、アプリの担当者が決めることである
