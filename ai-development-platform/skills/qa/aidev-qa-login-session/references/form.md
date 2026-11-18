# フォーム認証でのセッションの取得

アプリ自身がユーザー名とパスワードのフォームを持ち、送信するとアプリがセッションの Cookie を発行する方式で読む。ログインの判定の基準とセッションの確認は SKILL.md にあり、ここでは Playwright での書き方と、フォーム認証で起きやすい落とし穴を扱う。

## 構成

`automation/web/` に次を置く。ファイル名は例で、QA リポジトリにすでに決まりがあればそれに従う。

- `playwright.config.ts`：`setup` のプロジェクトと、それに依存するテストのプロジェクト
- `tests/auth.setup.ts`：ロールごとにログインし、storageState を保存する
- `tests/session.ts`：保存したセッションが使えるかを確かめる関数。setup と、後続のテストの前の確認の両方で使う

ロール、環境変数の名前、入口の URL、ログインが必要なページは、プロファイルから読み取って setup に渡す。コードに環境変数の値を書かない。

## 設定の例

```ts
// automation/web/playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  use: { baseURL: process.env.QA_BASE_URL },  // プロファイルの environments の url を渡す
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/, timeout: 60_000 },
    { name: 'staff', dependencies: ['setup'], use: { storageState: '.auth/staff.json' } },
  ],
});
```

`QA_BASE_URL` のような実行時の値は、作業者がシェルで設定するか、setup が読むプロファイルから決める。どちらにするかは QA リポジトリの決まりに合わせる。ロールが多いときは、プロジェクトをロールごとに作るより、テストの中で `test.use({ storageState: '.auth/<role>.json' })` を指定するほうが見通しがよい。

## setup の例

```ts
// automation/web/tests/auth.setup.ts
import { test as setup } from '@playwright/test';
import { assertSignedIn } from './session';

// プロファイルの roles と login から作る。値ではなく環境変数の名前を持つ
const roles = [
  { name: 'staff', userEnv: 'EXAMPLE_STAFF_USER', passwordEnv: 'EXAMPLE_STAFF_PASSWORD' },
];
const loginPath = '/login';      // login.entry_url のパス
const protectedPath = '/items';  // プロファイルの到達手順にある、ログインが必要なページ

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

    // 判定。ログイン画面から離れるか、エラーが出るかを待つ
    await page.waitForLoadState();
    const landed = new URL(page.url());
    if (landed.pathname === loginPath) {
      const text = (await page.locator('body').innerText()).slice(0, 500);
      throw new Error(`${role.name}: アプリで拒否（ログイン画面のまま）。資格情報かアカウントの状態を確かめる。画面: ${text}`);
    }
    if (landed.origin !== appOrigin || landed.pathname === '/') {
      throw new Error(`${role.name}: 着地点が不明（${landed.pathname}）`);
    }

    const path = `.auth/${role.name}.json`;
    await page.context().storageState({ path });
    await assertSignedIn(browser, baseURL, path, protectedPath, loginPath);
  });
}
```

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
- 送信の後に `waitForURL` で一覧などの特定のパスを待つと、失敗したときにタイムアウトの例外になり、どの判定かが分からない。ログイン画面から離れるのを待つか、読み込みの完了を待ってから URL を見る
- ログインの後の遷移先が、直前に開こうとしたページ（リターン URL）で変わるアプリがある。入口は毎回同じ URL から始める
- 入力欄はラベルやロールで探す。CSS のクラス名はデザインの変更で変わりやすい。ラベルがない画面では、`name` 属性や `data-testid` を使う
- ユーザー名とパスワードが2段階に分かれた画面では、2段目の入力欄が現れるのを待ってから入力する。どちらの段のボタンも同じ表示名のことがある
- CSRF トークンを hidden の入力欄で持つフォームは、ブラウザで送信すれば自動で付く。`request` で直接 POST する書き方にすると、トークンの取得を自分で書く必要がある
- 「ログイン状態を保持する」の選択肢は、テストではプロファイルや作業者の指示がなければ触らない。選ぶとセッションの寿命が変わり、期限切れの検出の前提がずれる
- CAPTCHA が出たら自動で突破しようとせず、作業者に伝えて止める。検証環境で無効にできるかは、アプリの担当者が決めることである
