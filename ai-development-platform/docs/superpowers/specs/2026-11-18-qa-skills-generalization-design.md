# QA 系 Skill の汎用化と QA 基盤の Skill 整備 設計書

作成日: 2026-11-18
状態: 案（承認待ち）

## 1. 目的

Gitea と C-HUB を前提にした QA 基盤（GA technologies の GAQ を参考にした構成）で使う Skill をそろえる。今ある QA 系の Skill は、どれか一つの案件の作業を前提に書かれており、案件をまたいで使えない。書かれた時期も古く、古いモデル向けの細かい指示やトークン節約のための省略が残っている。

この作業では次の3つを行う。

1. 既存の QA 系 Skill を、Opus 5.5 などの現行の Claude の性能に合わせて書き直す
2. 案件専用の Skill を、どの案件でも使える汎用 Skill と、案件ごとのプロファイルに分ける
3. QA 基盤の工程のうち、対応する Skill がない部分（設計レビュー、不具合起票、レポート、トレース検査）を新しく作る

### QA 基盤の前提（前回の検討で決めたこと）

| データ | 正本 | 相手側に置くもの |
|---|---|---|
| テスト計画・テストケース・実行結果・品質レポート | Gitea の QA リポジトリ（Markdown） | C-HUB にはリンクだけ |
| 証跡（スクリーンショット・トレース） | Gitea Actions の成果物、または LFS | なし |
| 不具合の内容（再現手順・証跡・修正 PR） | Gitea Issue | C-HUB には対応タスク1件とリンク |
| 工程の状態・担当・期限・人の判断待ち | C-HUB（品質保証ボード） | なし |
| 案件固有の観点・落とし穴・環境情報 | Gitea の QA リポジトリ（`knowledge/<product>/`） | なし |

ID は `C-HUB タスクID → AC-ID → TC-ID → run-id → Issue 番号 → 修正 PR → 改修確認の run-id` の順につなぐ。C-HUB には指摘や不具合の詳細を転記しない。社外の担当者も見るためである。

## 2. 目標・目標外・失敗とみなす状態

### 目標

- 新しい案件では、プロファイルを1つ書けば、Skill を書き換えずに QA の各工程を始められる
- 各 Skill の本文には、手順の目的、判断の基準、完了条件を書く。モデルが自分で判断できる細部は書かない
- QA の成果物は TC-ID・AC-ID などの共通の ID と形式でそろえ、`aidev qa trace` で機械的に検査できる
- 汎用 Skill は aidev-* と同じく、`metadata.version`、`skills/history.json`、テストで管理し、`aidev skill add` で配布する

### 目標外

- wordpress-*（wordpress-qa、journey-test、visual-check、site-audit、admin-check、qa-linux-update）。WordPress という基盤向けの製品で、すでにサイトをまたいで使える
- xUnit（C# の単体テスト。aidev-testing の領域）
- open-testing-*（外部の Skill）
- chub-team-status、auditing-chub-task-gaps（QA の工程ではない）
- テスト管理ツールの導入。閲覧には生成した HTML を使う
- C-HUB への書き込みの追加。ランナーによる C-HUB 連携は、[無人実行ランナーの設計](../../autonomous-runner-design.md) の段階に従う

### 失敗とみなす状態

技術的に動いても、次のどれかに当たれば失敗とする。

- 特定の案件（信州大学の campus／capi、Allcampus の CS アプリなど）の前提が、汎用 Skill の手順や完了条件に入り込む。この基盤は今後のすべての案件で使うもので、既存の案件はプロファイルの一例にすぎない
- 汎用化したせいで、旧 Skill が扱っていた種類の作業（既存画面の特性テスト、新旧環境の照合、認可の検証、Windows の GUI 操作など）ができなくなる
- 案件固有の値（URL、アカウント、ロール名、画面名）が汎用 Skill の本文に残る
- プロファイルに認証情報そのもの（パスワード、トークン、Cookie）が書かれる。書くのは、secrets のキー名と取得方法だけにする
- 利用者が手元に入れて編集した Skill が、配布や更新で上書きされる
- 検証を省くことが「効率化」として残る（例：test-execute の revert 検証の省略）

## 3. 制約

- Node.js 22 以上、strict TypeScript。変更後は `npm test` を通す（AGENTS.md）
- Skill の原本を変えたら `metadata.version` を上げ、`skills/history.json` を更新する（`scripts/skill-history.mjs`）
- 今の registry（`src/registry.ts`）は `skills/core/` だけを読み、SKILL.md が1つだけの Skill しか配布できない（`readdirSync(directory).length !== 1` で拒否する）。QA 系の旧 Skill には references・scripts・templates を持つものがある
- 旧 Skill は親リポジトリ（`~/.claude/skills`、GitHub の roonawa/skills）に直接置かれている。このリポジトリでは、エディタ連携が新しいブランチを自動で push することがあるため、作業前に push URL を無効にする
- 秘密情報を記録しない。プロファイル、証跡の名前、ログにも書かない

## 4. 検討した案

| 案 | 内容 | 利点 | 欠点 |
|---|---|---|---|
| **A. 汎用 Skill＋案件プロファイル（採用）** | Skill には手順と判断基準だけを書き、案件固有の情報は QA リポジトリの `knowledge/<product>/` に置いて実行時に読む | Skill の数が減る。新しい案件はプロファイルだけで始められる。QA 基盤のナレッジ層と同じ場所になる | 既存案件のプロファイルを書き起こす作業が要る |
| B. 汎用 Skill＋案件専用の薄い Skill | 汎用版を作り、旧 Skill を汎用版を呼ぶ薄い Skill として残す | 既存案件の使い勝手が変わらない | Skill の数が減らず、知識が Skill とリポジトリに分かれる |
| C. 汎用 Skill だけ | 案件の情報は作業者が会話で毎回渡す | 一番単純 | ナレッジが残らず、毎回の説明の手間が戻る |

利用者が A を選んだ（2026-11-18）。

## 5. 決定事項

### 5.1 Skill の構成

置き場所は `skills/qa/<name>/`。旧 Skill の役割との対応は次のとおり。

| 新 Skill | 元の Skill | 一般化の中身 |
|---|---|---|
| qa-strategy | qa-strategy | 書き直しのみ |
| qa-test-design | spec-test＋dev-test | 「設計書から作る」と「コードしかない（実装を正としない）」を入力の違いとして1つにまとめる。dev-test の「実装を疑う」原則は、コードしかない場合の必須の姿勢として残す |
| qa-test-review | 新規 | 作成したセッションとは別のセッションで、読み取り専用でレビューする。観点の漏れ・過剰、AC との対応、粒度を見る |
| qa-test-run | test-execute | C#/Java 限定をやめ、テストの実行方法をプロファイルから読む。revert 検証を省く方針をやめる |
| qa-characterization | campus-playwright＋cs-webview-regression-test＋capturing-playwright-evidence | 既存画面の挙動を記録する特性テストと証跡。画面マニフェストで網羅の分母を決める考え方を残す。Vue/GraphQL・WebView2 などの技術固有の話はプロファイルと参照資料へ移す |
| qa-regression-compare | capi-regression-test＋comparing-evidence-rounds | 新旧環境、または設定段階の前後の差分照合。差異を「一致／意図した差分／要確認」に分け、比較用の HTML を作る |
| qa-authz-test | capi-authz-test | ロールと操作の可否、行レベルの所有者検証（担当内／担当外、PK の乗っ取り防止） |
| qa-login-session | capi-saml-login | SAML・OIDC・フォーム認証で、認証済みのセッション（Cookie／storageState）を取得する。IdP 固有の情報はプロファイルへ移す |
| qa-desktop-gui | cs-native-regression-test＋automating-wpf-with-flaui | Windows の GUI 操作。PC を占有するテストは分けて実行する。FlaUI の知見は references に残す |
| qa-screen-verification | orchestrating-capi-screen-verification | 画面単位で、認可・回帰・証跡・照合をまとめて回す。上の Skill を順に使う |
| qa-fix-verify | test-verify＋uat-verify | 2つを統合する。修正コミットの特定、コードでの裏取り、revert して失敗し、戻して成功することの確認 |
| qa-cause-repro | cause-repro | 書き直しのみ |
| qa-bug-ticket | 新規 | NG になったケースから Gitea Issue を起票する。再現手順・証跡の参照・TC-ID・AC-ID を本文に入れる |
| qa-report | 新規 | 日次のまとめと品質レポート（不具合の傾向、残るリスク、AI が実行したケースの割合） |

### 5.2 Opus 5.5 向けの書き方

全 Skill に共通の書き方の基準とする。`qa-test-review` と Skill の検査（5.6）でも同じ基準を使う。

- 書くもの：目的、使う場面と使わない場面、入力と出力の形式、判断が分かれる場面の基準、完了条件、よくある誤り
- 書かないもの：モデルが自分で判断できる細かい手順、「必ず」「禁止」の羅列、強調のための太字の多用、トークン節約のための検証の省略
- 「必ず」は、外すと事故になるもの（秘密情報、上書き、証跡の捏造など）に限る。理由を一文で添える
- 本文は自然な日本語で書く（yomiyasu の基準）
- 長い参照情報（技術ごとの注意点、テンプレート）は references に分け、本文からどの場面で読むかを書く

### 5.3 案件プロファイル

QA リポジトリの `knowledge/<product>/profile.md` に置く。YAML の front matter と Markdown の本文を持つ。

front matter の項目（必須かどうかは、使う Skill ごとに決める）:

- `product`：識別子
- `environments`：環境名、ベース URL、用途（例：ST・PT、old-ST・new-PT）
- `roles`：ロール名と、テスト用アカウントの secrets のキー名
- `login`：方式（saml・oidc・form・native-form・certificate・none）、IdP、入口の URL。native-form は、デスクトップアプリ自身のログイン画面に、ID とパスワードを aidev-qa-desktop-gui が環境変数から読んで入力する方式で、ブラウザを通らないので storageState は作らない
- `stack`：フロントエンド・API・クライアントの技術（例：vue＋graphql、webview2、wpf）
- `test_commands`：テストの実行方法（例：`npx playwright test`、`dotnet test`）
- `issue_tracker`：NG のケースを起票する Gitea の種類、URL、リポジトリ（aidev-qa-bug-ticket が使う。トークンは書かない）
- `evidence`：証跡の保存方式と保持期間。方式は `lfs`（QA リポジトリの `runs/<run-id>/evidence/` を Git LFS で管理）、`external`（社内ストレージ。`result.md` には保存先の参照だけを書く）、`local`（作業者の PC）から案件ごとに選ぶ。個人情報が映る案件では `lfs` を選ばないよう、雛形に注意を書く。各 Skill は方式にかかわらず、`result.md` から証跡を同じ形で参照する

本文には、観点、落とし穴、テストデータの準備方法、画面への到達手順を書く。各 Skill は実行の最初にプロファイルを読み、使う項目が欠けていれば作業者に確認する。推測で埋めない。

プロファイルの形式は、この基盤の `templates/qa/` に雛形と記入例を置く。`aidev qa profile check FILE` で、YAML の形式、秘密情報らしい値（パスワード、トークン、Cookie の形）が入っていないこと、Skill ごとの必須項目を検査する。

### 5.4 成果物の形式

QA リポジトリの構成は次のとおり。

```text
qa-<案件>/
  plan/strategy.md
  cases/<機能>.md
  runs/<日付>-<run-id>/result.md
  knowledge/<product>/profile.md
  knowledge/<product>/*.md
  reports/
```

- `cases/*.md`：ケースごとに TC-ID、対応する AC-ID、優先度、自動・手動の区別、手順、期待結果
- `runs/*/result.md`：TC-ID ごとに OK・NG・実行不能、証跡の参照、NG のときの Issue 番号
- 各 Skill の出力は、この形式に従う。形式は `templates/qa/` に置き、`aidev qa trace` の入力になる

### 5.5 `aidev qa trace`

`aidev qa trace DIR` で QA リポジトリを検査し、JSON を返す。他のコマンドと同じく、成功は 0、失敗は 1 で終了する。

- どの TC にも対応しない AC がない
- NG の結果に Issue 番号がある
- 改修確認の OK 結果がある Issue だけを「確認済み」とする。Issue の開閉状態は Gitea に問い合わせない（読み取りの範囲を増やさない）。`result.md` に記録した改修確認の run-id を見る
- 実行不能のケースが、手動確認の項目として残っている

`--html FILE` を付けると、AC と TC の対応表と結果をまとめた HTML を出力する。

段階1〜3の結果を受けて、読み方を次のように決めた（段階4で実装）。

- `README.md` と、コードの囲み（``` と ~~~）の中は読まない
- `runs/` の直下のファイル（`<run>.compare.json` など）は読み飛ばし、ディレクトリだけを run として扱う。`runs/` の直下のリンクは、名前が run の形（`YYYYMMDD-run-id`）のときだけ、読めないものとしてエラーにする。ほかのリンクはファイルと同じく読み飛ばす
- `result.md` の冒頭には、環境・版・実行日時のほかに行が足されていることがある（「結果の決め方」「改修確認」「修正コミット」「元の run」など）。知らない行は無視する
- Issue を「確認済み」とするのは、改修確認の run の冒頭に `- 改修確認: #<N> 確認済み` があるときだけ。`要確認（…）` と `効いていない` は確認済みにしない。確認済みでも、その run 自身の表か後の run で、その Issue の TC が NG になれば要確認に戻す
- AC の出どころには `推定仕様 RS-xxx` もある
- 同じ原因でまとめた NG は、複数の TC の行に同じ `#N` が書かれる
- 手動のケースは `実行不能` で、理由が「手動確認待ち」

指摘は error と warning に分ける。error は、記録が抜けていて数字が信用できないものとし、1つでもあれば終了コードを 1 にする。

| 区分 | 指摘 |
|---|---|
| error | AC に TC がない（ac-uncovered）、acceptance.md にない AC を参照する TC（tc-unknown-ac）、Issue のない NG（ng-without-issue）、理由のない実行不能（blocked-without-reason）、重複した ID（duplicate-id）、ファイルがない・読めない（missing-acceptance、missing-cases、missing-result、unreadable）、読み飛ばすことになる AC の行とケースの見出し（acceptance-line、case-heading）、run の結果を読みきれない表（run-row、run-tc、run-result、duplicate-run-row、no-result-table） |
| warning | 改修確認と修正コミットの行の形（fix-check、duplicate-fix-check、fix-commit、fix-commit-unpaired）、ケースの AC と実行の行（case-ac、case-execution）、Issue の列の `#番号` 以外の値（run-issue）、cases/ にない TC の結果（run-unknown-tc）、未実行のケース（case-not-run）、確認済みでない Issue（issue-unconfirmed）、名前が run の形でない runs/ の下のフォルダ（run-dir） |

名前が run の形でないフォルダの result.md は数えられないが、run-dir は warning のままとした。HTML には TC-ID、結果、Issue 番号、run のディレクトリまでを載せ、証跡の欄を含む result.md の自由記述は載せない。HTML は求められたときだけ作り、報告の正本は qa-report の Markdown とする。

### 5.6 配布の仕組み

- registry を `skills/core/` と `skills/qa/` の両方から読むように変える。`skill list` に区分を表示する
- QA の Skill は references（Markdown）を持てるようにする。版の比較用のハッシュは、ディレクトリ内の全ファイルを対象にする。core の SKILL.md だけの Skill のハッシュは変わらないようにする（既存の `skills/history.json` との互換）
- 実行するスクリプト（比較用 HTML の生成など）は Skill に同梱せず、aidev CLI のコマンドとして TypeScript で実装し、テストする
- 旧 Skill は、各段階の移行が終わるまで親リポジトリに残す。削除するかどうかは、段階ごとに利用者が決める

### 5.7 名前と旧 Skill との共存（設計者の判断）

- 新しい Skill の名前は `aidev-qa-*` とする（例：`aidev-qa-test-design`）。5.1 の表の `qa-*` はこの略記。README の方針（`aidev-` 接頭辞で利用者の Skill と衝突させない）に合わせ、旧 `qa-strategy` との名前の重複も避ける
- 新しい Skill は `aidev skill add` で、QA リポジトリのプロジェクト直下に入れる。旧 Skill は利用者全体の `~/.claude/skills` に残る
- 移行期間中は発動条件が重なる。新しい Skill は見本の案件で確かめるため、旧 Skill と並べて動かす必要はない。旧 Skill を消すか残すかは、各案件の移行が済んだ時点で利用者が決める

### 5.8 AC の置き場所（設計者の判断）

AC の全件は `plan/acceptance.md` に置く（AC-ID、本文、出どころ）。qa-strategy または qa-test-design が、要件定義書・設計書・C-HUB のタスク本文（作業者が渡したもの）から作る。C-HUB の API からは読まない。`aidev qa trace` はこのファイルを AC の正本として読む。

### 5.9 実行場所と認証情報（設計者の判断）

- このプロジェクトで作る Skill は、作業者の PC での実行を前提にする。Gitea Actions のワークフローは作らない（無人実行は別の段階で検討する）
- 認証情報は環境変数から読む。プロファイルには環境変数の名前だけを書く。Actions で動かす場合も、同じ名前で secrets を渡せばよい。`qa profile check` は「値ではなく環境変数の名前が書かれていること」を検査する
- 証明書方式のログインは、Windows の証明書ストアにある証明書を拇印で指定する。拇印は秘密情報ではないため、プロファイルに書いてよい

### 5.10 スクリプトとレポートの移行（設計者の判断）

| 旧 Skill の同梱物 | 移行先 | 段階 |
|---|---|---|
| comparing-evidence-rounds の `generate-report.js` | `aidev qa compare-report`。顧客に出す HTML のため、見た目と構成は旧版を保つ | 2 |
| spec-test の `generate-report.js` | `aidev qa trace --html` に統合する | 4（段階1では旧スクリプトを使わず、Markdown だけを出す） |
| test-execute・test-verify・uat-verify の `templates/report.html` | 正本は `runs/*/result.md` とする。HTML は `aidev qa trace --html` と qa-report で作る。Artifact での公開は、作業者が求めた場合だけ行う | 2・3・4 |

### 5.11 Gitea Issue の起票（設計者の判断）

qa-bug-ticket は `aidev qa issue create` を呼ぶ。このコマンドは Gitea の API で Issue を作り、TC-ID・AC-ID・run-id・証跡の参照を、テンプレートに沿った本文で送る。トークンは作業者個人のもの（環境変数 `GITEA_TOKEN`）を使う。AI 専用アカウントは無人実行ランナー用で、このプロジェクトでは使わない。トークンの送り先は、作業者がトークンと並べて設定する環境変数 `GITEA_URL` とする。プロファイルの `issue_tracker.url` は送り先を決めず、その接続先（スキーム・ホスト・ポート）が `GITEA_URL` と一致することだけを確かめ、一致しなければトークンを送らずに止める。リポジトリのファイルを書き換えられても、トークンが別のホストへ流れないようにするための、段階3の実装で決めた判断である。コマンドは段階3で TypeScript で実装し、Gitea を模した偽のサーバーでテストする（`test/chub-fake.mjs` と同じ方式）。

### 5.12 既存の成果物（設計者の判断）

既存の仕様書・画面マニフェスト・証跡は、新しい形式に変換しない。新しい形式は、これから行う作業から使う。

## 6. 段階と完了条件

4つの段階に分け、順に進める。各段階は独立して完了とし、次の段階に進む前に利用者の確認を受ける。

完了の確認は、特定の案件の環境に頼らない。この基盤に、性質の違う2つの見本の案件を置き、どちらでも同じ Skill が動くことで汎用性を確かめる。

- **見本 Web**：`templates/qa/samples/web/`。小さな Web アプリ（ロール2つ、一覧・詳細・登録の画面、CSV 出力、フォーム認証）を Node で同梱し、手元で起動できるようにする。旧版と新版の2つの版を持たせ、意図した差分と意図しない差分を1つずつ入れる
- **見本 Desktop**：`templates/qa/samples/desktop/`。WPF の小さな画面（一覧、保存ダイアログ、メッセージボックス）。Windows でだけ確認する
- それぞれにプロファイル、AC、わざと入れた不具合を用意する

| 段階 | 内容 | 完了条件 |
|---|---|---|
| 1 土台 | registry の `skills/qa` 対応と references 対応、プロファイルの雛形と `qa profile check`、成果物の雛形、見本の2案件、qa-strategy・qa-test-design・qa-test-review | `npm test` が通る。見本の2案件それぞれで、qa-test-design が AC をすべて覆うテスト仕様書を作り、qa-test-review が、わざと抜いた観点を指摘する |
| 2 実行系 | qa-test-run、qa-characterization、qa-login-session、qa-desktop-gui、qa-regression-compare、qa-authz-test、qa-screen-verification | 見本 Web で、特性テストの記録、旧版と新版の照合（意図した差分と要確認の差分を正しく分ける）、ロールごとの認可の検証が、プロファイルだけを差し替えて動く。見本 Desktop で、ダイアログを含む GUI 操作の証跡が取れる |
| 3 不具合系 | qa-bug-ticket、qa-fix-verify、qa-cause-repro | 見本に入れた不具合が NG になり、Gitea を模した偽のサーバーへの起票、修正、改修確認まで ID がつながる |
| 4 レポートとトレース | qa-report、`aidev qa trace`（HTML を含む） | 段階1〜3の見本の QA リポジトリを trace にかけ、わざと入れた漏れを検出できる |

各段階の最後に、汎用 Skill の本文に、特定の案件の値（案件名、URL、ロール名、IdP 名）が残っていないかを検索で確かめる。

既存の案件（信州大学、CS アプリ）への適用は、この作業の完了条件に含めない。基盤ができた後、各案件の担当者がプロファイルを書いて移行する。その際に旧 Skill の知見（落とし穴、到達手順）を各案件のプロファイルへ書き写せるよう、段階2の作業で旧 Skill から抜き出した案件固有の記述を `docs/qa-migration-notes/<案件>.md` に残す。

## 7. 実装者に任せること

- 各 Skill の本文の具体的な文章と、references への分け方
- registry の変更の実装方法（区分の持たせ方、ハッシュの計算方法）。ただし、core の既存のハッシュとの互換は保つ
- `aidev qa trace` と `qa profile check` の JSON の項目名
- 成果物の Markdown の細かい書式（表にするか見出しにするか）
- 各 Skill の description の文言。発動の条件が旧 Skill と同じ場面を覆うことは確かめる
