# 信州大学キャンパス情報システム（リニューアル）の移行メモ

旧 Skill の campus-playwright、capturing-playwright-evidence、capi-saml-login、capi-authz-test、capi-regression-test、comparing-evidence-rounds、orchestrating-capi-screen-verification から、この案件に固有の記述を抜き出したものです。担当者は、次の順に写します。

1. 「front matter の案」を `knowledge/<product>/profile.md` の先頭に貼り、`product` と環境変数の名前を実際の運用に合わせる。
2. 「観点」「落とし穴」「テストデータ」「到達手順」の節を、profile.md の本文に貼る。長いものは `knowledge/<product>/` の下に別ファイルで置く。
3. `aidev qa profile check knowledge/<product>/profile.md` を流す。

内容は旧 Skill の2026年9月から10月の記述が元です。日付のある事実は、その時点のものとして扱ってください。

## 案件の前提

信州大学キャンパス情報システムのリニューアルは、画面の表示と操作を変えず、内部の API だけを campus 専用 API（campus-api、campus-login、campus-syllabus）に作り直す改修です。現行の実装の挙動そのものが仕様になるため、旧版の挙動を特性テストで記録し、新版と照合します。記録の元は、本番が停止中のため、暫定対策を入れたステージング環境の現行コードでした。

2026-09-16 に環境の向き先が変わりました。それ以降は次のとおりです。

- ST 環境が旧版（移行前）で、記録の対象です。
- PT 環境が新版（campus 専用 API への移行後）で、比較の対象です。
- 2026-09-16 より前に作ったマニフェスト、証跡、進捗記録の「PT 環境」は、当時の PT 環境（いまの ST に相当する環境）を指します。書き換える必要はありません。

## front matter の案

```yaml
---
product: shinshu-campus
environments:
  - {name: ST, url: https://allcweb3.local.ailesys.co.jp/campus/, purpose: 旧版（移行前）。特性テストの記録の対象。2026-09-16 以降}
  - {name: PT, url: https://allcweb2.local.ailesys.co.jp/campus/, purpose: 新版（campus 専用 API 移行後）。比較の対象。認可テストの対象}
# 環境ごとにアカウントが違うため、ロール名に環境を含める案。担当者の運用に合わせて変えてよい
roles:
  - {name: student-st, user_env: STUDENT_ST_ID, password_env: STUDENT_ST_PASSWORD}
  - {name: graduate-student-st, user_env: GRADUATE_STUDENT_ST_ID, password_env: GRADUATE_STUDENT_ST_PASSWORD}
  - {name: hiseiki-student-st, user_env: HISEIKI_STUDENT_ST_ID, password_env: HISEIKI_STUDENT_ST_PASSWORD}
  - {name: faculty-st, user_env: FACULTY_ST_ID, password_env: FACULTY_ST_PASSWORD}
  - {name: staff-st, user_env: STAFF_ST_ID, password_env: STAFF_ST_PASSWORD}
  - {name: job-information-st, user_env: JOB_INFORMATION_ST_ID, password_env: JOB_INFORMATION_ST_PASSWORD}
  - {name: general-citizen-st, user_env: GENERAL_CITIZEN_ST_ID, password_env: GENERAL_CITIZEN_ST_PASSWORD}
  - {name: company-representative-st, user_env: COMPANY_REPRESENTATIVE_ST_ID, password_env: COMPANY_REPRESENTATIVE_ST_PASSWORD}
  - {name: student-pt, user_env: STUDENT_PT_ID, password_env: STUDENT_PT_PASSWORD}
  - {name: graduate-student-pt, user_env: GRADUATE_STUDENT_PT_ID, password_env: GRADUATE_STUDENT_PT_PASSWORD}
  - {name: hiseiki-student-pt, user_env: HISEIKI_STUDENT_PT_ID, password_env: HISEIKI_STUDENT_PT_PASSWORD}
  - {name: faculty-pt, user_env: FACULTY_PT_ID, password_env: FACULTY_PT_PASSWORD}
  - {name: staff-pt, user_env: STAFF_PT_ID, password_env: STAFF_PT_PASSWORD}
login:
  method: saml
  entry_url: https://allcweb2.local.ailesys.co.jp/saml2/authenticate/campus
stack: [vue, graphql, campus-api, campus-login, campus-syllabus, element-plus]
test_commands:
  - {name: e2e-st, run: npx playwright test --project=chromium}
  - {name: e2e-pt, run: npx playwright test --project=chromium}
evidence: {method: external, retention: 90d}
---
```

書き写すときの注意は次のとおりです。

- `login.method` は PT の SAML を書いています。ST は ID とパスワードのフォーム（`use-local: true`）なので、aidev-qa-login-session では環境ごとに方式を分けて扱います。ST だけを使う作業なら `form`、PT の SAML を使うなら `saml` にし、環境ごとの違いは本文の「ログイン」の節に書いてください。
- 旧 Skill の間で環境変数の名前が揃っていません。campus-playwright は ST が `<ロール>_ST_ID`、PT が `<ロール>_PT_ID`（それぞれの `_PASSWORD`）、capi-saml-login は `STUDENT_ID`、`FACULTY_ID`、`STAFF_ID`、`GRADUATE_STUDENT_ID`、`HISEIKI_STUDENT_ID`（それぞれの `_PASSWORD`）と、職員だけ `STAFF_PT_ID` と書いていました。実際に使っている `.env` の名前を確かめて、profile.md の名前を合わせてください。上の案は campus-playwright の形にそろえています。
- 求人情報、一般市民、企業担当は PT でも専用のログインで通るため、PT の分は書いていません。必要なら足してください。
- `test_commands` は旧 Skill に決まった書き方がなく、Playwright の構成（`playwright.config.ts` の projects）から決める想定です。実際のプロジェクト名は担当者が確かめてください。
- `evidence` の方式は、この案件が学生や教員の個人情報を扱うため、`lfs` を避けて `external` にした案です。保存先は担当者が決めます。
- 資格情報の値は、旧 Skill の運用では担当者のホーム配下の `pw/.env`（`E2E_CREDENTIALS_FILE` で上書き可）に置いていました。QA リポジトリには入れません。

## 環境と体制

| 役割 | 環境 | 場所 | 補足 |
|---|---|---|---|
| 旧版（移行前）、記録の対象 | ST | `https://allcweb3.local.ailesys.co.jp/campus/`、設定は `.env.st` | `application-st.yml` が `use-local: true`。ログイン画面は ID とパスワードのフォーム |
| 新版（移行後）、比較の対象 | PT | `https://allcweb2.local.ailesys.co.jp/campus/`、設定は `.env.pt` | `application-pt.yml` が `use-local: false`。学生、大学院生、教員、職員は SAML でしかログインできない |

- 両環境とも自己署名または内部 CA の証明書です。Playwright では `ignoreHTTPSErrors: true` が要ります。付けないと `net::ERR_CERT_AUTHORITY_INVALID` でナビゲーション自体が失敗します。
- PT の証明書は 2026-09-17 の時点で期限切れでした（`CERT_HAS_EXPIRED`）。Node の `fetch` で直接叩くテスト（認可テスト）では、旧 Skill はテスト実行専用の環境変数 `NODE_TLS_REJECT_UNAUTHORIZED=0` で回避していました。CA を信頼ストアに足しても、証明書自体が期限切れなので直りません。恒久の対応は PT の証明書の更新で、報告に含めます。更新が済んだら、この回避は外します。
- ST と PT は別のデータベースです。担当授業、担当部局、履修などの紐づきが、PT で記録した時点とは違うことがあります。ケースごとに、アカウントが実際にどのデータに紐づくかを確かめます。
- 環境の ST と PT が、旧版と新版のどちらを指すかは、いつも決め打ちにしません。実行の前にデプロイ状態を確かめます。

### リポジトリと実パス

| 役割 | リポジトリ | 必須のブランチ | 備考 |
|---|---|---|---|
| 旧版（ST） | `allcampus` | `test-regression-branch` | 既定のブランチのままでは、記録側と同じ内容の ST 環境にならない |
| 新版（PT） | `allcampus-regression` | 指定なし | 別のドライブにあることがある。ホーム配下だけを探して「ない」と判断しない |

- Playwright の作業ディレクトリは、どちらも `frontend/campus` です。依存は `frontend/node_modules` に巻き上がっていて、`frontend/campus/node_modules` が空でも動きます。`npm install` が husky の prepare で失敗するときは `--ignore-scripts` を付けます。
- 新版側のリポジトリは、旧版側より古いコピーのことがあります。新旧の比較は同じテストコードを両環境に流す前提なので、spec、templates、マニフェストは旧版側から新版側へ同期してから実行します。`playwright.config.ts` と `templates/auth.ts`（アカウントの環境変数名が違う）は同期しません。
- 新版側に `coverage/screens/` がないことがあります。マニフェストを置かないと、spec が読み込み時に例外で落ちます。
- ファイルごとの正の側は一律ではありません。2026-09-18 の実測では、`coverage/authz/` は新版側だけにあり、`templates/` と `playwright.config.ts` は旧版側が上位集合でした（`loginAsRoleLocal`、`loginAsKigyou`、`captureFailureScreenshot`、`manifestNewOperationName` などは旧版側にしかなかった）。共有のハーネスやテンプレートを触る前に、両方の同名ファイルを比べ、どちらを採ったかと理由を記録します。
- 認可テストのハーネスは新版側の `backend/campus/tools/authz-test-harness` が正です。旧版側のコピーは古いことが多いので、着手時に両方の `src/` のファイル一覧を比べ、`src/persistedDocuments.ts` がない側を古いと見ます。

## ログイン

### ST（旧版）

ST では、`/login` が SAML へのリダイレクトではなく、ID とパスワードのフォーム（`.login-id`、`.login-pass` の `el-input`、`Login.vue`）を出します。学生、大学院生、非正規生、教員、職員は、`templates/auth.ts` の `loginAsRoleLocal`（`loginByLocal` 系）でログインできます。2026-09-17 に、6つのロール（学生、大学院生、非正規生、教員、職員、一般市民）で実際に認証できることを確かめました。

| ロール | 環境変数の名前（ID と各パスワード） | ログインの方法 | 内部のロール |
|---|---|---|---|
| 学生 | `STUDENT_ST_ID`、`STUDENT_ST_PASSWORD` | `loginAsRoleLocal` | `ROLE_STUDENT` |
| 大学院生 | `GRADUATE_STUDENT_ST_ID`、`GRADUATE_STUDENT_ST_PASSWORD` | `loginAsRoleLocal` | `ROLE_STUDENT`（学部生と同じ。区分コードで判定が分かれる操作は別に確かめる） |
| 非正規生 | `HISEIKI_STUDENT_ST_ID`、`HISEIKI_STUDENT_ST_PASSWORD` | `loginAsRoleLocal` | `ROLE_STUDENT`（studentType が non-degree） |
| 教員 | `FACULTY_ST_ID`、`FACULTY_ST_PASSWORD` | `loginAsRoleLocal` | `ROLE_INSTRUCTOR` |
| 職員 | `STAFF_ST_ID`、`STAFF_ST_PASSWORD` | `loginAsRoleLocal` | `ROLE_STAFF` |
| 求人情報（卒業生 WEB 検索、OB） | `JOB_INFORMATION_ST_ID`、`JOB_INFORMATION_ST_PASSWORD` | `loginAsJobob`（専用のログイン。SAML 不要） | `ROLE_JOBOB` |
| 一般市民 | `GENERAL_CITIZEN_ST_ID`、`GENERAL_CITIZEN_ST_PASSWORD` | `loginAsCitizen`（専用のログイン。SAML 不要） | `ROLE_CITIZEN` |
| 企業担当 | `COMPANY_REPRESENTATIVE_ST_ID`、`COMPANY_REPRESENTATIVE_ST_PASSWORD` | `loginAsKigyou`（`kyuujinEntry/MntLogin.vue` のフォーム） | `ROLE_KIGYOU` |

- 「内部のロール」は設計書の記述からの対応づけです。実機のロール表示と食い違うときは、実機を正とします。
- 企業担当は、ログイン後に `/campus/portal` ではなく `kyuujinEntry/ManagerPortal` へ遷移します。
- PT で恒久的に失敗していた `loginForCitizen` の不具合は、ST では再現せず、一般市民が「市民開放授業受講者」として認証できました。

### PT（新版）

- PT は `use-local: false` のため、`loginByLocal` は常に失敗します。学生、大学院生、教員、職員の4ロールは、SAML でしかログインできません。
- PT の SAML の IdP は OneLogin（`https://ailesystem-corp-dev.onelogin.com`）です。社内が管理するテスト用のクラウド IdP で、本番の IdP（大学の Shibboleth と GakuNin）とは別物です。画面の構造も段数も同じとは限らないので、この自動化は本番の IdP にそのまま使えません。
- 開始 URL は `/saml2/authenticate/campus` です。`baseURL` が `/campus/` 配下でも、SAML のエンドポイントはホストの直下にあるため、`page.goto('/saml2/authenticate/campus')` のように先頭の `/` を付けます。画面の遷移側（`gotoScreen` など）は逆に先頭の `/` を付けません。
- OneLogin は2段のフォームで、どちらの段のボタンも `Continue` です。ユーザー名は `#username`（`input[name="username"]`）です。SAML の POST 先は `/trust/saml2/http-post/sso/...` です。
- 発行される Cookie は、nginx が `/saml2/**` をどのアプリへ転送しているかで変わります。2026-09-09 の PT は既存の `backend/api` に転送していて `JSESSIONID` が発行され、2026-09-16 に web02 の nginx が campus 専用 API（`backend/campus`）に切り替わって `campus_session`（httpOnly、Secure、SameSite=Strict）が発行されるようになりました。転送先はこれからも変わりうるので、実行の前に storageState に `campus_session` があるかを確かめます。Cookie の有無だけでログインの成否を決めません。
- storageState の寿命は数時間です。2026-09-17 に、午前に取った storageState が午後には失効していました。実行の直前に作り直します。
- setup の `timeout` は 180000 ms、`retries` は 2 にしていました（OneLogin の画面の描画に数十秒かかることがある）。
- 認可テストなどで Cookie の値と CSRF トークンを使う場合は、`getLoginStatus` を campus-login のエンドポイントに投げます。campus-api には存在せず、投げると `success:false` が返り、セッション切れと見分けがつきません（2026-09-17 に実際に誤診断が出ました）。mutation には `X-CSRF-Token` のヘッダーを付けます（認証トークン設計書 6.1 節）。許可リストを強制する環境では `extensions.documentId` が要り、campus-login のマニフェストから解決します。
- 参照実装は `frontend/campus/templates/auth.ts` の `loginAsRole()`、`frontend/campus/e2e/auth.setup.ts`（ロールごとに `e2e/.auth/<role>.json` を保存）、`frontend/campus/playwright.config.ts` です。

### SAML と無関係な専用のログイン

求人情報（`ROLE_JOBOB`）、一般市民（`ROLE_CITIZEN`）、企業担当（`ROLE_KIGYOU`）は、`loginForJobob`、`loginForCitizen`、`loginForKigyou` という専用の mutation で通ります。`use-local` にも nginx の転送先にも依存しません。dev、st、cp、devpt、staging の各環境も `use-local: true` なので、SAML は要りません。

SAML が実際に要るのは、認可テスト（常に PT が対象）と、PT 側の新旧比較で、あるロールが SAML でしか入れないと分かった場合だけです。

### アカウントの状態

- 大学院生のアカウントは、OneLogin 側でパスワードが期限切れになり、2026-09-09 に新しいパスワードの設定画面で止まりました。共有アカウントのパスワードは勝手に変えません。そのロールの setup だけを環境変数のフラグ（`E2E_GRADUATE_ENABLED` と `E2E_CITIZEN_ENABLED`）付きで skip し、理由、確認した日、復旧の手順をコメントに残します。
- skip のフラグは古くなります。2026-09-17 には、フラグを渡すだけで大学院生も一般市民もログインできました。skip の日付が古ければ、まずフラグを立てて試します。
- 職員の SAML ログインが、2026-09-17 に両方のリポジトリ合わせて7回続けて失敗し（OneLogin のパスワードの段で止まり、エラーの表示もなし）、同じ日の後刻に、同じ資格情報で成功しました。保存した資格情報は終始正しいものでした。失敗が続くときは、`.auth/<role>.json` の更新日時、他のロールの結果、パスワード送信後の画面のテキストの順で確かめ、時間を置きます。連続して試すと IdP 側でロックされるおそれがあります。報告は「実行不能（要再試行）」とし、「アカウントの制約で恒久的に不可」とは書きません。

## 画面とリポジトリの対応

- Playwright の spec は `frontend/campus/e2e/<エリア>/<画面>.spec.ts` に置いています。ない場合は `documents/campus専用API/playwright-nightly/screens/<route_name>/03_spec.ts` を探します。
- 画面マニフェストは `coverage/screens/<ScreenId>.json`、認可のマニフェストは `coverage/authz/*.json` です。どちらも `.gitignore` の対象で、git の履歴からは追えません。マニフェストに `testCode` や `executionResult`（「ST 8 passed」など）が書いてあっても、参照先の spec が残っていなければ、基準はないものとして扱います。2026-09-18 に、履修・成績エリアの12画面のうち4画面でこの状態が実際に起きました。
- 新版のクライアントは `src/services/campus/` の下です。画面のデータ取得が共有のコンポーネントにあることが多く、画面の `.vue` だけを見て移行済みかどうかは判断できません。履修・成績エリアの画面の多くは20行ほどのラッパーです。

  | 画面 | ラッパーの中身 | 判定 |
  |---|---|---|
  | `DaimokuKensaku`、`Syuutyuu`、`Kakunin` | `DaimokuBase` を呼ぶ | `DaimokuBase.vue` が `campusRisyuu.*` を呼ぶので移行済み |
  | `Syuutoku` | `Alsyuutoku` を呼ぶ | `Alsyuutoku.vue` が旧 `useApiService` のままなので未移行。サーバー側の新しい操作（`getRisyuuEnrollmentCreditsList`）だけ先にある |
  | `SeisekiCsvOutput` | 比較用のルート | `routes.ts` で `development`、`dev2`、`pt`、`st` のときだけ登録される。設計書 4.3 節の12番が本番の対象外と明記しているので、移行されない |

- 移行済みかどうかを `git log` で調べるときは、`--grep=campus-api` だと取りこぼします（コミット件名が「campus専用API: …」の形のものがある）。実体のコンポーネントのパスに当て、`git log --oneline -i --grep='campus[-専用]*api' -- <実体のコンポーネント>` のようにします。
- `Kakunin.json` の `route` は `/portal/Kakunin` で、`rishuuseiseki/Kakunin.vue`（履修確認）のマニフェストではありません。画面名だけで対応づけず、`route` の欄を確かめます。
- 時間割では、`omrcode` と `code` が別の時間割コードを指していて、711 行（全体で 10,166 行）が不足していた件があります（履修・成績エリア）。
- 帳票は `DownloadFile.ts` が呼ぶ `/api/download/*`（`backend3/fileout` 由来）です。一覧は `campus-api_設計書.md` の 2.3 節にあります。
- 新版のクライアントは、リクエストの本文に `operationName` を載せず、`query` も固定のプレースホルダ（`query campusPersistedQuery { __typename }`）にして、`extensions.documentId`（SHA-256）だけで操作を指します。新版の捕捉は、コミット済みの許可リスト（`backend/campus/src/main/resources/graphql/persisted/campus-api.json` と `campus-login.json`）で、documentId を操作名へ逆引きします。旧版の API は従来どおり本文に `operationName` を載せるため、両方に対応した判定にします。これがないと、PT のケースは「応答が来ない」タイムアウトになり、差分ではなく偽の「差異なし」になります（2026-09-17 に実際に発生）。
- GraphQL のエンドポイントは1本とは限りません。旧版は単一のエンドポイント（`<root>/api`、末尾が `/graphql` ではない）、campus 専用 API は `<root>/campus-api/graphql` などです。捕捉とモックの URL の条件は両方に合わせます。
- 設計書は、`campus-api_設計書.md`（5章の既知の不具合と4.3節のロール別の仕様）、`campus-syllabus_設計書.md`（4章）、`campus-login_設計書.md`、`campus専用API_構成図.md`（6章の Payload の設計規則）、`認証トークン設計書.md`、`セキュリティインシデント対策案.md` です。

## 観点

- 画面の表示、内部データ（API の応答）、帳票（PDF と CSV）の3点を、新旧で照合します。記録の対象は正常系が基本で、ロールや表示モード（タブ、ラジオボタン）で挙動が変わる組み合わせの分だけシナリオを作ります。必須入力のフォームには、必須ありと必須なしの2パターンだけを足します。
- 記録の深さは操作ごとに変えます。ロールのガードだけの単純な操作は軽く、担当範囲や複合条件による行レベルの制御を伴う操作（C-3、fileout、career 相当）にフルの手順を使います。
- 一覧と詳細の取得が分かれた画面（Payload の設計規則）では、詳細側が通ることをもって、一覧側の列を省略しません。一覧の期待値は、画面に出た全列を対象にします。フラグからラベルへの変換のように、期待値の組み立てを書き直すと転記ミスになる列は、記録時点の ST の画面の文字列をそのまま期待値にします。
- ポータルの例では、現行は12操作（うち8つが汎用の `getFilteredXxx`）を呼び、新版は7操作（query 6つと mutation 1つ）に統合されました。お知らせ一覧の応答は 128,538 バイトから 21,209 バイトに減りました（83.5% の削減）。ロールごとに表示のブロックが変わります（次の授業は学生と教員だけ、時間割は学生本人だけ、など）。
- 認可は、第1層のロールのガードと、第2層の行レベルの所有者の検証（本人 ID の強制、主キー乗っ取りの防止）の両方を確かめます。更新の操作では、担当内の主キーと担当外の主キーの両方に同じ mutation を流し、後者が拒否されることまで見ます。
- 正解表は `身分別取得可能情報一覧マトリックス.xlsx`（13 身分と 27 情報区分。凡例は「全件参照可」「自分の情報のみ」「担当◯◯のみ」「自社分のみ」「なし」の5つ）です。Sheet2 が情報区分の定義、Sheet4 が旧システムの出席情報の権限です。マトリックスは画面ベースの整理なので、API 単体で届くかどうかは含みません。表を写しただけのテストでは、画面を通さない ID の直接指定を見逃します。
- 既知の不具合は7件（`campus-api_設計書.md` 5章）で、回帰のテストにも入れます。主なものは、成績保存の mutation（`createTblBuseiseki` など5本）で担当授業と登録期間の検査がない件（7番）と、身上の汎用 CRUD の mutation が認可なしで他の学生の行を乗っ取れる件（2番）です。
- ロールが同じでも属性で期待が変わります。`ROLE_STUDENT` は、学部生、大学院生、非正規生で期待値が違う情報区分があります。ロール名だけでケースを1つに決めません。
- 認可の拒否は `FORBIDDEN` で判定します。空の応答や、何らかのエラーを拒否とは数えません。想定外のエラーの型は、別の不具合を疑います。
- 学生が `TblQrsyussekiController`（指定授業の出席状況）経由で `gakumu.tbl_buseiseki` に触れたとき、先頭の行が本人でないケースが 60,697 件ありました。正解表の「自分の履修科目と打刻情報のみ」と食い違う可能性が高く、新版で最優先に確かめます。
- 認可テストの優先順位は、`セキュリティインシデント対策案.md` のフェーズ（0 は止血、1 は高リスクで分離不要、2 は分離を伴う、3 は低リスクで基盤整備）に従います。
- 認可の現状の棚卸し（`別紙A_全API一覧と取得内容_API単位.csv`、5,930 件。役割の判定なしが 5,917 件、行レベルの絞り込みなしが 5,548 件、あり（本人限定）が 37 件）は、修正前のベースラインです。あるべき姿はマトリックスにしかなく、棚卸しを正解と取り違えません。
- 認可の判定のための参考資料は、`別紙D1_画面別_呼び出されるAPI一覧.csv`（画面から API への対応）、`別紙_教員による学生参照の根拠照合.csv`（担当授業、指導教員、担当グループという担当内と担当外のペアの見本）、`別紙_行レベル判定結果.csv`（ロール、操作、テーブルごとの実測の件数）です。
- 認可の既知の不具合の判定は、記憶や印象でなく、設計書を一次情報にします。campus-api は設計書の5章と4.3節の「既知の不具合の疑い」の欄、campus-syllabus は4章、campus-login は該当する課題を見ます。設計書に「修正済み、現在の正しい挙動として踏襲する」とあるもの（`studentType: no-student` など）は、除外すべき既知の不具合ではありません。除外の対象は、いま未解決のものだけです。
- 旧版の記録では `excluded` の `known-authz-bug` に入れていた操作は、新版の認可テストの対象にも必ず加えます。正常系の記録がない書き込みの操作が含まれ、拾い漏れると検証されないままになります。
- 新しい版にだけある正しい姿（引数から学籍 ID が消えた、平文のパスワードを返さなくなった、など）は、新旧の差として扱わず、認可の観点で別に確かめます。
- 旧 API（`/api`）は、PT でも稼働したままです。`campus_session` の Cookie で参照系のクエリが通ります。身上の汎用 CRUD の問題（2番）は、画面が旧 API を呼ばなくなっても、旧エンドポイントに当該の mutation が残って届くなら未解消です。他の学生の行への書き込みの検証は、共有環境の他人のデータを壊しうるため行わず、開発側に確認を頼みます。

## 落とし穴

- 新旧比較で「応答が来ない」を「差異なし」と読まない。新版は `operationName` を送らないため、捕捉が documentId の逆引きに対応していないと全件がタイムアウトします。
- `newOperationName` を無条件に優先すると、埋めた瞬間に旧版（ST）の実行が壊れます（新しい操作名は ST で一度も発生せず、待機がタイムアウトする。2026-09-17 に発生）。実行の対象を環境変数 `E2E_TARGET`（`old` か `new`）で明示し、未指定ならホスト名（`allcweb3` は旧版、`allcweb2` は新版）から決めます。解決は共通のヘルパー（`templates/manifestOperations.ts`）に置きます。
- 同じページで複数の `operationName` をモックするときは、`route.continue()` でなく `route.fallback()` を使います。`continue()` は、後から登録したモックだけを有効にし、先のモックは実ネットワークへ素通りします。
- モックの応答は、対象のコンポーネントが実際に読むフィールドを過不足なく含めます。同じ実体を指す別名の ID（`id` と `simpleId` など）が別の分岐で使われていることがあります。ある応答のあとに起きる後続の呼び出し（授業の詳細、履修データ、Web 履修の可否、シラバスの公開判定）まで辿って、すべてモックします。モックが効いているかは、診断ログで1件確かめてから複製します。
- ダイアログ（`position: fixed` のオーバーレイ、Element Plus の `.el-overlay` と `.el-dialog`）が開いている間は、`fullPage` のスクリーンショットを使いません。ダイアログが元のビューポート1画面分の帯にしか描かれず、崩れた証跡になります。失敗時のスクリーンショットも `fullPage: false` を既定にし、`trace` は `retain-on-failure` にします（`on-first-retry` は、`retries: 0` のローカル実行では何も残さない）。
- 撮影のたびに、画面上部の固定ヘッダーを隠します（`display: none` を当てる、またはヘッダー分をクリップする）。操作の後には 0.5 秒待ちます（ダイアログの開閉中の透過の途中で撮らないため）。共通のヘルパーに、この2つが実際に実装されているかを、実行の前にコードで確かめます。2026-09-17 に、どちらも実装されていないヘルパーで撮影が量産されました。
- 証跡の名前は `<画面>_<ロール>_<シナリオ>.png` の形でした。
- storageState が失効したまま、`expect(page.locator('body')).toBeVisible()` のような緩い検査で通すと、OneLogin のログイン画面を撮ったまま「成功」になります（2026-09-17）。ログインした画面の識別できる要素を検査し、最終 URL が IdP のホストでないことも確かめます。
- 証跡の完全性を、画面ごとのファイル数の合計で判断しません。2026-09-17 に、合計が ST 132、PT 148 で「揃った」と報告したところ、ある画面の9ケースすべてで新版のスクリーンショットが0枚でした。ケース単位かつ環境単位で数えます。
- 旧版（ST）と新版（PT）のフォルダは `old-ST` と `new-PT`、ケース ID は同じものを使い、`<ラベル>_<時刻>/old-ST/e2e-evidence/` のように置いていました。統合したフォルダには `collection-summary.json`、`COMPLETENESS_GATE.md`（ケース単位の ST と PT の成否の表）、`REGRESSION_DIFF_JUDGEMENT.md`（差異を「一致、意図した差分、要確認」に分けた結論）を置いていました。新しい Skill では、証跡が `runs/<YYYYMMDD>-<run-id>/evidence/<TC-ID>/` に、照合の結果が `runs/<比較先の run>/compare.md` に入ります。
- 新旧の環境比較で、golden-master の生の pass と fail をそのまま OK と NG に写しません。API の刷新では、内部データの検査（②）だけが新しい Payload の形に未対応で機械的に落ち、画面の表示（①）は新旧で一致していることがよくあります。判定済みの成果物の①を優先します。
- PT 側の失敗は、テストコードの不備、環境の要因、意図した差分、要確認の順に分類します。新しい Payload を読めずに全件失敗しているのを「意図した差分」と分類すると、新版の画面表示を1件も検証していません。新版の実行の前に、期待値の読み出しの切り替えを1ケースで実測します。
- 0件や空の応答は、実装が壊れている場合とデータがない場合があります。DB に届かない環境（PT）では、「判定不能」で止めず、旧 API（`/api`）で同じデータを参照するなど、独立した別経路で裏取りします（2026-09-17 に、DB に届かず判定が手詰まりになった）。
- 2026-09-17 には、新版の23ケースのうち17ケースがタイムアウトした事例もあります。
- 時系列のラウンド（1回目、2回目、3回目と再実行を重ねる比較）は、2026-09-25 に廃止しました。最終の結果だけを集めて出します。段階比較（同じ環境で設定を入れる前と後）は廃止の対象外です。
- サーバーの監査ログの集計で、リクエストの拒否やエラーを確かめる依頼では、ケースごとの開始と終了の時刻（Asia/Tokyo）と操作名を渡し、集計は依頼側の担当者が行います。集計がないケースは「一致」にしません。
- 認可テストのハーネスを使い回すときの2026-09-17 の事例として、古いコピーを先に見たために、すでに直っていた documentId の未対応と `getLoginStatus` のエンドポイントの誤りを書き起こし直した重複がありました。ログインの mutation には、同じ操作名で複数版の documentId が許可リストに登録されていることがあります。失敗の理由（`failureReason`）を出せる版を選びます。
- 対象のデータが見当たらないとき、内部の ID の形式（`GraphQlId` のパック形式）を逆算して作った ID で代用しません。正規の手段（管理画面からの登録、既存のシーディングのスクリプト、データ管理者への依頼）でデータを用意し、それも難しければ「未実施（テストデータの準備不可）」と報告します。
- 認可の不具合を見つけても、その場で実装を直しません。検証者が自分で直して自分で「解消済み」と判定すると、独立した検証になりません。失敗として記録し、まとめて報告します。
- 認可テストを後から追加で流すときは、テストアカウントが一時的に使えず止まったロールだけを `--role <ロール名>`（カンマ区切りで複数）で再実行します。書き込みでメールが飛ぶ他のロールのケースを巻き込んで全件を流し直しません。複数のレポートを統合して、同じケース ID は後の結果で上書きします。
- storageState が失効していると、画面がログインに戻され、「操作が起きなかった」「権限がない」と誤って観測されます。

## テストデータ

- 必要なロール、担当範囲、データの件数の組み合わせが、既存のアカウントと ST の実データで用意できないときは、確認の順序を変えずに（先に既存のもので足りるかを確かめる）、確認のうえで足りなければ自分で ID とデータを作ります。理由と内容を明記してマニフェストに残します（旧 Skill では `testDataSource: self-created` を使っていました）。開発者や環境担当へのアカウント発行の依頼は並行して行ってよく、その回答を待つことを、実装を止める理由にしません。
- 検索や帳票で0件になるときは、0件のまま記録せず、複数件の状態を作ってから記録します（0件の表示そのものを確かめるケースは別です）。
- 担当内と担当外のペアのデータは、教員と学生の関係なら `別紙_教員による学生参照の根拠照合.csv` の形（担当授業の受講生、指導教員、担当グループの学生）に倣います。職員と部局の関係なら、権限マスタ（`mst_kengen`、`mst_kengen_shozoku`）と `GakusekiShozoku1Guard` を手がかりに、担当部局に属する学生と属さない学生をマスタテーブルから探して用意します。
- 教員の「担当授業あり」のように、紐づくデータが要るシナリオは、アカウントが実際にどの授業や部局に紐づくかを、ST の側のデータで確かめます。
- 更新の操作では、専用のデータと、元に戻す手順を決めます。

## 到達手順

- ST の通常の記録では、`.env.st` を使い、`loginAsRoleLocal` などのログインのヘルパーで入ります。SAML は使いません。
- PT で新旧比較をするときは、実行の直前に setup を流して storageState を作り直します。旧版（ST）、新版（PT）の順に、同じテストコードを `E2E_TARGET` で切り替えて流します。
- 認可テストは常に PT を対象にします。学生、大学院生、教員、職員は SAML の storageState から `campus_session` の Cookie を取り出し、campus-login で CSRF トークンを取ります。求人情報、一般市民、企業担当は、専用の mutation で入ります。
- リクエストの形は、`https://<PT のホスト>/campus-api/graphql` に対する POST です。mutation には `X-CSRF-Token` を付け、ログインは `https://<PT のホスト>/campus-login/graphql` です。Cookie がないか CSRF トークンが不正な mutation は、実行の前に `FORBIDDEN` になります。未認証で campus-api を叩くと 401 です。
- ロールのガードの確認は、学生本人のクエリ（`getCumulativeGPA` など、対象の学籍を引数で受けないもの）で、正のケース（本人）と負のケース（教員など対象外のロールで `FORBIDDEN`）を取ります。
- 画面から認可テストへ操作を渡すときは、画面のマニフェスト（`coverage/screens/<ScreenId>.json`）の `operations` と `reports`、さらに `excluded` のうち `known-authz-bug` のものを、認可テストの対象の操作の入力に渡します。

## 旧 Skill の独自の機構（新しい Skill には移していない）

旧マニフェストには、次のフィールドがありました。新しい `automation/web/manifests/` の形式とは違います。旧マニフェストは変換せず、必要な画面は記録し直します。

- `newOperationName`：新版で改名、統合、分割された操作名や帳票の URL。分割は配列、統合は同じ名前を各エントリに入れる。記録時点では `null`
- `acceptedRisks`：既知の不具合をリスクとして受け入れ、記録の対象に含める。`decidedBy` と `decidedDate` が必須
- `resolvesKnownIssue`、`deployedVersionCheck`、`versionNote`、`noTargetsReason`
- `excluded` の理由のコード：`dead-code`、`known-authz-bug`、`authz-test-scope`、`known-authz-scope-out-of-production`
- 画面マニフェストの `depth`（軽量かフル）と `risk`

新しい Skill での同じ役割は、画面マニフェストの除外の理由、aidev-qa-authz-test の認可の表、プロファイルの本文に書く決定の記録で受け持ちます。リリースを優先して認可の是正を後に回す、という決定は、承認者と日付を添えて、プロファイルの本文か `knowledge/<product>/` に残してください。

## 値が書かれていた箇所（担当者が確認すること）

旧 Skill には、パスワードやトークンの値は見つかりませんでした。次の箇所には、テスト用アカウントの ID らしい文字列が書かれています。旧 Skill に値が書かれているため、担当者が確認して、環境変数または secrets へ移してください。この文書には写していません。

- capi-authz-test の `SKILL.md` に、dev 環境の実機確認の例として、学生のアカウントの ID と教員のアカウントの ID（`getCumulativeGPA` の確認結果の行）
- capi-authz-test の `SKILL.md` に、求人情報のログインの例として、ユーザーコード（パスワードの欄は `<password>` のプレースホルダ）

あわせて、campus-playwright の「環境体制の変更」には、資格情報ファイルの場所が担当者のホーム配下の絶対パスで書かれています。パスは写さず、環境変数の名前だけを使ってください。
