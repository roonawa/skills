# Playwright での特性テストの書き方

ブラウザで開く Web の画面の特性テストを書くときに読む。WebView2 の画面は `webview2.md` を先に読み、接続の部分だけを置き換える。証跡の撮り方と保存先は `evidence.md` にある。

## 構成

`automation/web/` に次を置く。ログインの setup と storageState のパスの関数は aidev-qa-login-session が作るものを使い、ここで作り直さない。ファイル名は例で、QA リポジトリにすでに決まりがあればそれに従う。

- `playwright.config.ts`：QA リポジトリで1つだけの Playwright の設定。この資料が形を決め、ほかの Skill はプロジェクトを足すだけにする（次の節）
- `manifests/<画面>.json`：画面マニフェスト
- `tests/<機能>-char.spec.ts`：特性テスト。`<機能>-char` は SKILL.md の「名前の決まり」による。1つの TC に1つのテストを対応させ、テスト名の先頭に TC-ID を付ける
- `tests/support/manifest.ts`：マニフェストを読み、実行している環境に合った捕捉の条件を返す
- `tests/support/record.ts`：checkpoint ごとにスクリーンショット、表示値、API の応答を、`QA_RUN_DIR` の `evidence/<TC-ID>/` に保存する

## 設定

Playwright の設定は QA リポジトリに1つだけ置き、形はこの資料で決める。aidev-qa-login-session、aidev-qa-authz-test、aidev-qa-test-run は、自分のプロジェクトがなければ足し、既存の設定にある項目は書き換えない。設定のファイルを丸ごと書き直すと、ほかの Skill のプロジェクトや出力先が消える。

```ts
// automation/web/playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  outputDir: 'test-results/pw',   // Playwright は実行のたびにこの中を消す。診断用のファイルを置かない
  workers: 1,
  retries: 0,
  use: {
    baseURL: process.env.QA_BASE_URL,   // プロファイルの environments の url
    actionTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    // setup は aidev-qa-login-session のもの。トレース、動画、スクリーンショットは切ってある
    { name: 'setup', testMatch: /auth\.setup\.ts$/, use: { trace: 'off', video: 'off', screenshot: 'off' } },
    // 特性テスト（この Skill）
    { name: 'characterization', dependencies: ['setup'], testMatch: /-char\.spec\.ts$/ },
    // WebView2 の画面の特性テスト。CDP で接続するので setup に依存しない（webview2.md）
    { name: 'webview2', testMatch: /-char\.webview2\.spec\.ts$/ },
    // 認可の表のテスト（aidev-qa-authz-test）
    { name: 'authz', dependencies: ['setup'], testMatch: /-authz\.spec\.ts$/ },
    // テストケースのテスト（aidev-qa-test-run）。ほかのプロジェクトの spec を除く
    { name: 'cases', dependencies: ['setup'], testMatch: /\.spec\.ts$/,
      testIgnore: [/-char(\.webview2)?\.spec\.ts$/, /-authz\.spec\.ts$/] },
  ],
});
```

ファイル名の末尾でプロジェクトが決まる。

| Skill | spec のファイル名 | プロジェクト |
|---|---|---|
| aidev-qa-characterization | `tests/<機能>-char.spec.ts`（WebView2 の画面は `tests/<機能>-char.webview2.spec.ts`） | `characterization`（`webview2`） |
| aidev-qa-authz-test | `tests/<機能>-authz.spec.ts` | `authz` |
| aidev-qa-test-run | `tests/<機能>.spec.ts`（上の2つの末尾を使わない） | `cases` |

- 出力先は `test-results/pw/` にする。Playwright は実行のたびに `outputDir` を空にするので、失敗した実行の証跡、照合の確かめに使う写し、作った対象の ID、プロセスの ID のような診断用のファイルは、QA リポジトリのルートの `.qa-scratch/`（`.gitignore` で除外されている）に置く。`test-results/` に置くと次の実行で消える
- プロファイルの `test_commands` は、プロジェクトかファイルで絞った形で書く（例 `npx playwright test -c automation/web --project=characterization`）。何も絞らない `npx playwright test` は、ほかの Skill の spec まで流す。TC-ID の範囲で絞るときは、ファイルを指定するか、`|` を使わない `--grep`（例 `--grep "TC-loans-char-00[1-3]"`）にする
- Windows では、`npx` が cmd の中継（`npx.cmd`）を通るため、`--grep "a|b"` の `|` がパイプとして扱われて壊れることがある（実機で確かめた）。`|` が要るときは、中継を通さず `node node_modules/@playwright/test/cli.js test --grep "a|b"` で流すか、ファイルとプロジェクトで絞る
- spec のファイルは、エージェントのファイルを書く道具で書き、シェルのヒアドキュメントで書かない。正規表現の `\` や `$` がシェルに解釈されて壊れる（実機で確かめた）。区切りの語を引用符で囲んだ形（`<<'EOF'`）でも、実行の環境によっては `\\` が `\` に変わる。書いた後に、正規表現の行を読み返して `\` の数を確かめる

- 実行する環境は `QA_ENV`（プロファイルの環境名）と `QA_BASE_URL` で渡す。URL やホスト名をテストに書かない。同じテストを別の環境に流せなくなる
- `workers: 1` で順に流す。共有のテスト用アカウントで並列に操作すると、互いのデータの状態を変える
- `retries: 0` にする。更新を伴うケースで自動の再試行があると、二重に登録されることがある。また、再試行で通ったテストは不安定さを隠す
- `actionTimeout` を設定する。設定しないと、隠れた要素への操作がテスト全体の時間切れまで黙って待つ
- トレースは `retain-on-failure` にする。`on-first-retry` は `retries: 0` では何も残さない。トレースは診断に使い、扱いは `evidence.md` の秘密情報の節に従う
- ロールはテストの中で `test.use({ storageState: authFile('<role>', process.env.QA_ENV) })` で選ぶ。`authFile` は aidev-qa-login-session のもので、環境ごとに分けた `automation/web/.auth/<environment>/<role>.json` を返す。環境の引数を省くと、別の環境のセッションを読むことがある
- ロールと表示モードの組み合わせは、ケースの表を配列にし、`for` で回して1つの TC に1つのテストを作る。テスト名の先頭は TC-ID にする（例 ``test(`${c.tc} ${c.role} ${c.mode}`, ...)``）。1つのテストの中で表を回すと、1つの失敗で残りの組み合わせの結果が分からなくなる。ロールごとに `test.describe` で囲み、その中で `test.use` を呼ぶ

## 対象の画面にいることを確かめる

各ケースの最初と撮影の前に、意図した画面にいることをアサートする。`body` が見えることだけの確認では足りない。期限切れのセッションでログイン画面に落ちても、テストが通ってしまう。

- URL のオリジンが記録する環境のもので、パスが対象の画面のものである
- ログイン画面、IdP のホスト、エラー画面に移っていない
- 対象の画面の見出しや、ログイン中だけ出る要素が見える

## API の応答を記録する

API の応答は、操作の前に待ち受けを登録してから操作する。操作の後に登録すると、速い応答を取り逃がす。

```ts
// tests/support/manifest.ts（抜粋）
export function matcherFor(manifest: ScreenManifest, apiId: string, env = process.env.QA_ENV) {
  const api = manifest.apis.find(a => a.id === apiId);
  if (!api) throw new Error(`マニフェストに ${apiId} がない`);
  const match = (env && api.matchByEnvironment?.[env]) || api.match;  // 環境ごとの条件があればそれ、なければ記録したときの条件
  return (response: Response) => matches(response, match);
}

// spec の中
const listed = page.waitForResponse(matcherFor(manifest, 'API-01'));
await page.getByRole('tab', { name: '返却済み' }).click();
await recorder.saveResponse('02-returned', 'API-01', await listed);
```

- 捕捉の条件は、マニフェストの `match` と `matchByEnvironment` から作る。テストに操作名やパスを文字列で書かない
- 応答は、状態コードと本文を保存する。応答のヘッダーは保存しない（`Set-Cookie` やトークンが入る）。リクエストの本文も既定では保存しない。検索の条件が照合に要るときだけ、条件の項目を選んで保存する
- GraphQL は HTTP 200 でも本文の `errors` にエラーが入ることがある。画面がそれを握りつぶして「データがありません」と出すこともある。`errors` が1件以上あれば、画面が正常に見えても NG の候補にする
- 1つの画面が複数のエンドポイント（例えば `/api` と `/graphql`）に送ることがある。捕捉の条件が片方しか見ていないと、もう片方の操作を待ち続ける
- persisted query を使う構成では、本文に操作名がなく、ハッシュや ID だけを送ることがある。その場合は、リポジトリにある許可リスト（ハッシュと操作名の対応）で逆引きする関数を捕捉の条件に持たせる。操作名で見つからないことを「その操作が呼ばれなかった」と読み違えない
- 一覧がページごとに同じ操作を何度も送る画面では、checkpoint ごとに回数と各回の応答を保存する

`apis` の網羅を確かめるために、`page.on('request')` と `page.on('response')` で、時刻、メソッド、パス、操作名、状態コード、エラーの件数を記録し、直前の checkpoint に結び付ける。ここでは本文やヘッダーの値は保存しない。

## 画面の値を記録する

スクリーンショットとは別に、画面に出た値を構造化して JSON で保存する。照合で差を見つけやすく、画像の差より原因を追いやすい。

- 一覧は、表示されたすべての列を、行ごとに保存してアサートする。人が選んだ一部の列だけにしない
- 値の変換（フラグからラベルへ、など）をテストの中で書き直して期待値を作らない。転記の誤りのもとになる。記録した時点の画面の文字列をそのまま期待値にしてよい
- 部品によっては、値が `innerText` ではなく内側の `input` の value にある（選択の部品など）。読み方は対象の画面で確かめる
- 期待値は、別の検索の結果から導ける形にすると強くなる（範囲で絞った結果は、絞らない結果のうち範囲に入る行と同じ、など）。「1件以上出る」だけにしない
- データに依存する候補（ある条件の行、ある担当者）は、思い込みで決めず、テストの中で画面の検索結果から選ぶ。選んだ値と、選んだ根拠の件数を checkpoint の値に保存する。候補がなければ条件を緩めて通さず、データの事情を報告する
- 行は安定したキーで選ぶ（条件に合う行のうち ID が最小のもの、名前を決めて用意した記録）。「一覧の先頭の行」で選ばない。並び順が変わる改修では、旧版と新版で別の行を開き、照合が成り立たなくなる（実機で確かめた）

## 帳票を記録する

```ts
const download = page.waitForEvent('download');
await page.getByRole('button', { name: 'CSV 出力' }).click();
const file = await download;
const runDir = process.env.QA_RUN_DIR;  // runs/<YYYYMMDD>-<run-id> のパス。テストを流す前に設定する
if (!runDir) throw new Error('QA_RUN_DIR を設定してください');
await file.saveAs(path.join(runDir, 'evidence', 'TC-loans-char-020', file.suggestedFilename()));
```

- ダウンロードの待ち受けは、操作の前に登録する
- ファイルがあることだけで成功としない。CSV は列の名前、行数、値を、PDF は文字の内容を記録してアサートする。並び順が仕様なら順序も見る
- 作成日時のように毎回変わる値は、次の節の正規化の規則で限られた項目だけを置き換える。元のファイルは残す
- ダウンロードの URL を直接開いて代わりにしない。画面の操作で出ることを記録するのが目的である
- OS の保存ダイアログが出る実装は、ブラウザの外の操作になる。マニフェストで `native-required` にし、aidev-qa-desktop-gui に渡す

ダウンロードされないこと（権限のないロールで出力できない、など）を確かめるケースは、次の順に書く。

```ts
const downloads: string[] = [];
page.on('download', d => downloads.push(d.suggestedFilename()));   // 操作の前に登録する
const opened = await page.goto('/loans.csv').then(() => 'page' as const, (e: Error) =>
  /Download is starting/.test(e.message) ? 'download' as const : Promise.reject(e));
await recorder.shot('01-after');                                    // 判定の前に撮って値を保存する
await recorder.saveValues('01-after', { opened, downloads });
expect(opened, 'ダウンロードが始まった').toBe('page');
expect(downloads).toEqual([]);
```

- ダウンロードを返す URL を `page.goto` で開くと、Playwright は `Download is starting` の例外を出す。例外を「開けなかった」と読まず、ダウンロードが起きたこととして記録する
- 撮影と値の保存を判定より先に置く。判定を先にすると、ダウンロードされてしまったときに証跡が残らない（実機で確かめた）

## 実行ごとに変わる値の正規化

画面の文字列をそのまま期待値にすると、作成日時、採番された ID、更新日時、今日の日付、テストデータの接頭辞 `QA-<run-id>-` のように実行ごとに変わる値で、挙動が同じでもテストが落ちる。逆に、これを避けようとして比較から外す範囲を広げると、本当のデータの差まで見えなくなる。次のように扱う。

- 正規化するのは、名前を挙げた項目だけにする（例 `API-01` の `items[].createdAt`、一覧の「更新日」の列、CSV の「出力日時」の列）。項目ごとに、形式（`pattern`）、置き換え（`replacement`）、元の値の妥当性の確かめ（`mustMatch`）を書く。書き方は `screen-manifest.md` の「正規化の規則（normalize）」にある
- 正規化した値とは別に、元の値も保存する。照合で疑問が出たときに戻れるようにする
- 規則は画面マニフェストの `normalize`（`screen-manifest.md`）に書き、テストはそこから読む。aidev-qa-regression-compare も同じ規則で照合する。テストの中だけに規則を書くと、照合の側と食い違う
- 期待値を固める前に、同じケースを2回記録して差を取る。2回で変わった値だけが実行ごとに変わる値の候補で、それ以外の差は挙動として扱う。1回の記録から推測で正規化の対象を決めない
- データの差を消すために、スクリーンショットの `mask`、値の除外、正規化の対象を広げない。行全体や表全体を外す規則は作らない。広げたくなったら、データの準備（`SKILL.md` の「データやアカウントが足りないとき」）か、記録する条件を見直す

## 待ち方

意味のある条件で待つ。応答、読み込みの表示が消えること、ダイアログが出ること、一覧の件数の表示を待つ。`networkidle` や固定の時間だけで完了とみなさない。

アニメーションの途中で撮ると、半透明のダイアログのような実機と違う画像になる。操作の後に短い固定の待ち（数百ミリ秒）を入れる場合は、共通の操作の関数に1か所だけ置き、時間を設定で変えられるようにする。固定の待ちは撮影の安定のための補助で、完了の判定には使わない。

検索の条件は、中止やダイアログを閉じる操作では戻らないことが多い。ケースや手順ごとに、使う条件を毎回明示的に設定する。前のケースが残したダイアログは、次のケースの最初に閉じてから始める。確認のダイアログは「いいえ」で閉じ、閉じ方が分からないものが残っていたら止める。

## 更新を伴う操作のケース

登録、確認、修正、確認、削除、確認を1つの流れとして `test.describe.serial` に並べ、前のケースが失敗したら後のケースは実行不能（前段の失敗）にする。後始末は流れの外に置いた最後のテスト（例 `TC-loans-char-099 後始末`）にし、前段が失敗しても走るようにする。`afterAll` ではテストの単位の `page` が使えない。後始末は自分の接頭辞の付いたデータだけを画面の操作で消し、残っていないことを検索し直して確かめる。

必須項目なしのケースでは、エラーの表示に加えて、保存されていないことを検索し直して確かめ、更新の API が呼ばれていない（`expectAt` の `max: 0`）ことも見る。

## モックを使うとき

特性テストは実際の挙動を記録するので、モックは使わないのが基本である。データを作れない状態を見せるために使うときは、次に気をつける。モックが効かずに実際の通信に素通りしても、テストは一見通ったり落ちたりするだけで気づきにくい。

- 同じページで複数の操作をモックするときは、ハンドラーの中で対象でない要求を `route.fallback()` で渡す。`route.continue()` は他のハンドラーを飛ばしてネットワークへ送るため、先に登録したモックが効かなくなる
- 1つの応答が返った後に続けて呼ばれる操作（詳細を取った後の関連データの取得など）も、ソースをたどってすべてモックする
- モックの応答には、部品が実際に参照する項目を過不足なく入れる。似た名前の ID が別の分岐に使われていることがある
- 最初の1件で、ハンドラーの中に一時的なログ（捕まえた URL、期待した操作名、実際の操作名、応答を差し替えたか）を入れて流し、効いていることを確かめてから他のケースに広げる。確かめたらログは消す

モックで作った状態の記録は、実際の挙動の記録と区別できるよう、テスト名とマニフェストに書く。

## よくある落とし穴

- 自己署名の証明書の検証環境では、`ignoreHTTPSErrors: true` がないと最初の遷移で失敗する。本番に近い環境では有効にしない
- 同じルートへの遷移では画面が作り直されないアプリがある。ケースの最初に、メニューやトップから開き直す
- 通知（トースト）は数秒で消える。出た直後に読むか撮る
- テストの spec を直したら、結果をまとめる前に全ケースを同じコードで、新しい run-id の run に流し直す。その実行を最終の run とし、`runs/` にはその証跡だけを置く（`evidence.md` の「保存先と名前」）。一部のケースだけを同じ run のディレクトリに流し直さない。流し直しと書き込みを伴うケースの扱いは、aidev-qa-test-run の「データの状態と流し直し」に従う
