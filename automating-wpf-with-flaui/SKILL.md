---
name: automating-wpf-with-flaui
description: Use when a WPF desktop app needs to be driven through its real GUI via FlaUI/UI Automation (UIA) to run screen-level test cases — selecting rows, clicking buttons/menus, or detecting dialogs — especially when native MessageBox dialogs, multi-monitor layouts, or owner-window nesting cause elements to go undetected.
---

# Automating WPF Apps with FlaUI

## Overview

FlaUI/UI AutomationでWPFアプリの実画面を操縦してテストを実施するとき、UIAパターンの選び方と実機特有の落とし穴（多重モニタ、Owner付きダイアログの入れ子、モーダルダイアログによるUIA全体スタール）を押さえないと、テストが不安定または原因不明の形で失敗する。NGが出た場合は、テストコードを直して緑にするのではなく、エビデンス（スクリーンショット・再現手順）を残したまま開発者に引き継ぐ。ソースコード自体の修正も禁止する。

## When to Use

- テスト仕様書の「画面」種別TCを、実際に動いているWPFアプリのGUIを操作して実施したいとき
- FlaUI/UI Automation（UIA）でボタン押下・行選択・メニュー操作・ダイアログ検出を自動化したいとき

対象外（他スキルに任せる）：
- Webブラウザの自動化（Playwright等）→ 別スキル
- ロジック/APIレベルのみの自動テスト（GUIを一切操作しない）→ `test-execute`
- テスト仕様書自体の新規作成 → `spec-test`

## Core Pattern

1. **データ隔離した状態で実アプリを起動する**（設定ファイルを一時退避し、隔離データフォルダを向けて起動。終了時に必ず元へ戻す）
2. **UIA操作はInvoke系パターンを優先する**（`AsButton().Invoke()`、`AsListBoxItem().Select()`、`AsCheckBox().IsChecked = true`）。座標ベースの`.Click()`とキーボードニーモニックの連打は最小限に留める
3. **モーダルダイアログを伴う操作は、UIA呼び出し全体をスタールさせる可能性を疑う**。ネイティブ`MessageBox.Show(...)`がイベントハンドラ内で同期的に開くと、開いている間はDesktop列挙のような無関係なUIA呼び出しまで長時間タイムアウトすることがある。疑われる場合は、操作を別スレッドで発火し、ダイアログの検出をUIAではなくWin32 API（`EnumWindows`/`EnumChildWindows`）で行う
4. **NGが出たら、テストコードを直さずに報告する**。スクリーンショット＋再現手順をエビデンスとして残し、テスト・実装いずれのコードも修正しない（詳細は Common Mistakes 参照）

## Quick Reference

| やりたいこと | 推奨パターン | 避けるもの |
|---|---|---|
| ボタンを押す | `element.AsButton().Invoke()` | 座標クリック |
| 一覧の行を選ぶ | `element.AsListBoxItem().Select()` | 座標クリック |
| チェックボックスを操作 | `element.AsCheckBox().IsChecked = true` | 座標クリック |
| メニューを開いて項目を選ぶ | Alt+キーでメニューを開く（キーボードのみ）→ 項目は`AsMenuItem().Invoke()`で選ぶ | メニュー項目自体をキーボードニーモニックで辿る |
| Owner付きダイアログ（`RenameScenarioWindow`等）を待つ | オーナーウィンドウの`FindAllDescendants`を先に探し、無ければDesktop直下も探す（両方try/catchで包む） | Desktop直下だけを探す |
| 同期的に開くネイティブMessageBoxを待つ | 操作を`Task.Run`で発火 → `EnumWindows`/`EnumChildWindows`で検出 | UIA経由で検出し続ける（長時間タイムアウトしうる） |
| ダイアログのタイトル文字列 | 呼び出し元コード（`MessageBox.Show(...)`）を`grep`して確認する | 画面から推測した文字列をそのまま使う |

## Implementation

### 1. データ隔離した状態での起動

設定ファイル（例：`%APPDATA%\<App>\settings.json`）を一時退避し、隔離データフォルダを指す設定に差し替えてからアプリを起動する。**実行前に対象アプリの既存プロセスが動いていないか確認し、動いていれば起動を拒否する**（利用者の実データフォルダへ誤って干渉しないため）。

```csharp
public sealed class IsolatedEditorFixture : IDisposable
{
    private static readonly string SettingsPath =
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "<App>", "settings.json");
    private readonly string? _originalSettingsContent;
    private readonly bool _settingsExistedBefore;
    public string IsolatedDataRoot { get; }

    public IsolatedEditorFixture()
    {
        if (Process.GetProcessesByName("<App>").Length > 0)
            throw new InvalidOperationException("既存プロセスが起動中。共有データフォルダへの干渉を避けるため、事前にすべて閉じること。");

        IsolatedDataRoot = Path.Combine(Path.GetTempPath(), $"qa_isolated_{Guid.NewGuid():N}");
        Directory.CreateDirectory(IsolatedDataRoot);

        _settingsExistedBefore = File.Exists(SettingsPath);
        _originalSettingsContent = _settingsExistedBefore ? File.ReadAllText(SettingsPath) : null;
        Directory.CreateDirectory(Path.GetDirectoryName(SettingsPath)!);
        File.WriteAllText(SettingsPath, "{\"DataRoot\":\"" + IsolatedDataRoot.Replace("\\", "\\\\") + "\"}");
    }

    public (Application App, UIA3Automation Automation, Window Window) LaunchEditor()
    {
        var app = Application.Launch(exePath);
        var automation = new UIA3Automation();
        Window? window = null;
        for (int i = 0; i < 50 && window == null; i++)
        {
            Thread.Sleep(200);
            try { window = app.GetMainWindow(automation); } catch { /* まだ起動中 */ }
        }
        if (window == null) throw new TimeoutException("メインウィンドウが起動しなかった。");
        return (app, automation, window);
    }

    public void Dispose()
    {
        foreach (var p in Process.GetProcessesByName("<App>"))
        { try { p.Kill(); p.WaitForExit(3000); } catch { } }

        if (_settingsExistedBefore) File.WriteAllText(SettingsPath, _originalSettingsContent!);
        else if (File.Exists(SettingsPath)) File.Delete(SettingsPath);

        try { Directory.Delete(IsolatedDataRoot, recursive: true); } catch { }
    }
}
```

### 2. Owner付きダイアログの待機（オーナー配下とDesktop直下の両方を探す）

WPFの`Owner`付きダイアログは、UIA上ではDesktop直下のトップレベル兄弟としてではなく、**オーナーウィンドウのサブツリーの子孫として**現れる。逆に`Owner`を指定しない（あるいはネイティブ）ダイアログはDesktop直下に出る。どちらか分からない場合は両方探す：

```csharp
public static Window WaitForNewWindow(AutomationElement ownerWindow, string titleContains, int timeoutMs = 8000)
{
    var start = DateTime.UtcNow;
    while ((DateTime.UtcNow - start).TotalMilliseconds < timeoutMs)
    {
        try
        {
            var match = ownerWindow.FindAllDescendants(cf => cf.ByControlType(ControlType.Window))
                .FirstOrDefault(w => (w.Name ?? "").Contains(titleContains));
            if (match != null) return match.AsWindow();
        }
        catch (System.Runtime.InteropServices.COMException) { }
        catch (TimeoutException) { }

        try
        {
            var desktopMatch = ownerWindow.Automation.GetDesktop().FindAllChildren()
                .FirstOrDefault(w => (w.Name ?? "").Contains(titleContains));
            if (desktopMatch != null) return desktopMatch.AsWindow();
        }
        catch (System.Runtime.InteropServices.COMException) { }
        catch (TimeoutException) { }

        Thread.Sleep(150);
    }
    throw new TimeoutException($"新しいウィンドウが開かなかった（{titleContains}）");
}
```

### 3. 同期モーダルによるUIA全体スタールの回避（実例：未保存確認ダイアログ）

行を選択すると、そのイベントハンドラ内でネイティブ`MessageBox.Show(...)`が同期的に開く画面があるとする（例：「未保存の変更」の3択確認）。この状態を素朴に`row.Select()` → `WaitForNewWindow(...)`という順で書くと、`Select()`自体がダイアログが閉じるまでブロックされ、**Desktop列挙のような無関係なUIA呼び出しまで長時間タイムアウトする**ことが実機で確認されている（UIA3AutomationインスタンスのCOM呼び出しが直列化されるためと見られる）。

対処：操作を別スレッドで発火し、検出はUIAではなくWin32 APIで行う。

```csharp
// 1. 操作を別スレッドで発火するだけにし、完了を待たない
_ = Task.Run(() => { try { rowB.AsListBoxItem().Select(); } catch { } });

// 2. 検出はWin32 API（対象プロセスのPIDで絞り込む）
var hWnd = Win32Native.WaitForTopLevelWindow((uint)app.ProcessId, "未保存の変更");
var buttons = Win32Native.GetButtonTexts(hWnd); // EnumChildWindowsでクラス名"Button"の子を列挙
Assert.Equal(3, buttons.Count);
```

`Win32Native`は`EnumWindows`（PIDと可視性で絞り込み、タイトル部分一致）と`EnumChildWindows`（クラス名"Button"の子のテキストを列挙）の薄いP/Invokeラッパーでよい。UIAに頼らないため、モーダルによるスタールの影響を受けない。

### 4. ダイアログのタイトル文字列は必ずソースで確認する

`MessageBox.Show(message, title, ...)`の呼び出し元を`grep`し、実際の`title`引数を確認してから検索文字列に使う。メッセージ本文に含まれる単語（例：バージョンエラーの本文中の「本体」）とタイトルを混同しない——検索は原則タイトル（ウィンドウ名）に対して行うため、本文にしか出てこない単語では見つからない。

### 5. NG時のエビデンス採取と報告

NGを解消するためにテストコードを修正して緑にすることはしない。代わりに：

1. 失敗する手順をそのまま再現し、要所（操作前・操作直後）で`FlaUI.Core.Capturing.Capture.Screen().ToFile(path)`によりスクリーンショットを撮る
2. スクリーンショットは案件のエビデンス用フォルダ（例：`QA\エビデンス\<機能ID>\`）に保存する
3. テスト仕様書・報告書に、TC-IDごとに「再現手順」「実際の結果（エラーメッセージ等）」「エビデンス画像へのパス」「所見（アプリ側の不具合か、テスト側の実装の問題かの一次判断。最終判断は開発者に委ねる）」を書く
4. スクリーンショット採取用に一時的なテストコード（デバッグハーネス）を書いた場合は、エビデンス採取後に削除し、対象のNGテスト自体のコードは元のNGが出る状態のまま残す

## Common Mistakes

- **座標ベースの`.Click()`を使う** → 多重モニタ環境（特に負の座標を持つ副モニタ）で実際のクリック位置がずれて失敗する。`Invoke()`/`Select()`/`IsChecked`等のUIAパターンを使う
- **ダイアログのタイトル文字列をソースコード確認せずに推測で使う** → メッセージ本文とタイトルを取り違えたり、実際の文言と異なるまま検索してタイムアウトする。`MessageBox.Show(...)`の呼び出し元を必ず確認する
- **NGを解消するためにテストコードを動かして緑にする** → NGの原因がテストコード側にあるかアプリ側にあるかを自分で判断して修正してしまうと、開発者に引き継ぐべき不具合の情報が失われる。NGはNGのまま、再現手順とエビデンスを添えて報告する
