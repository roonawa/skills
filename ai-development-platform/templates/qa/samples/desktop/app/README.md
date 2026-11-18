# 在庫一覧アプリ（見本・架空）

`requirements.md` を実装した WPF アプリです。QA Skill の動作確認に使います。わざと入れた不具合はありません。保存に失敗したときは、落ちずに「保存できませんでした」のエラーメッセージボックスを出します（要件の外の備え）。

## ビルドと起動

.NET SDK 9 以上と Windows が必要です。

```
dotnet build templates/qa/samples/desktop/app -c Release --nologo
templates/qa/samples/desktop/app/bin/Release/net9.0-windows/SampleStock.exe
```

初期データは、実行ファイルと同じ場所の `stock.csv`（5 行）から読みます。ビルドのたびにコピーされます。

## 主な要素の AutomationId

`StockGrid`、`SaveButton`、`DeleteButton`、`StatusText`。確認と警告のメッセージボックス、保存ダイアログは標準のもので、本体ウィンドウを所有ウィンドウとして開きます。
