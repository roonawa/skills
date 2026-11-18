---
product: sample-desktop
stack: [dotnet, wpf, flaui]
test_commands:
  - {name: gui, run: dotnet test}
evidence: {method: local, retention: 90d}
---
# 観点

操作は行の選択、保存ダイアログ、削除の確認の 3 系統である。メッセージボックスとファイルダイアログは本体とは別のウィンドウとして開くため、画面操作ではダイアログの検出が前提になる。

# 落とし穴

メッセージボックスは本体ウィンドウの子として開く。本体だけを探すとダイアログを見落とすので、デスクトップ直下から所有ウィンドウをたどる。

# テストデータ

起動時に読み込む在庫の初期データは、開発用の固定の CSV に 5 行入れてある。削除のテストは、実行ごとに初期データへ戻す。

# 到達手順

アプリを起動すると、そのまま在庫一覧の画面が開く。保存と削除は、画面下のボタンから行う。

ビルドは `dotnet build templates/qa/samples/desktop/app -c Release --nologo` で行い、`bin/Release/net9.0-windows/SampleStock.exe` を起動する。初期データは同じ場所の stock.csv から読む。

画面の主な要素の AutomationId は次のとおり。

- `StockGrid`: 在庫の表
- `SaveButton`: 保存ボタン
- `DeleteButton`: 削除ボタン
- `StatusText`: ステータスバーの文字
