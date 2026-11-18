# FlaUI でのテストの書き方

`automation/desktop/` に FlaUI（UIA3）のテストを書くとき、要素が見つからない・操作が返らないといった問題を調べるときに読む。ダイアログごとの扱いは `dialogs.md` にある。

## プロジェクトの形

`automation/desktop/` には C# のテストプロジェクトを1つ置く。テストの枠組みは xUnit を例にするが、案件の既存のテストが MSTest や NUnit なら合わせる。

```text
automation/desktop/
  DesktopTests.csproj
  AppSession.cs          起動、要素の検索、ダイアログの待ち、証跡の撮影、終了
  Win32Windows.cs        UIA が返らないときの検出（必要になったら足す）
  Tests/
    <機能>Tests.cs       機能ごとのテスト。テスト名の先頭に TC-ID
```

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net9.0-windows</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <IsPackable>false</IsPackable>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="FlaUI.UIA3" Version="5.0.0" />
    <PackageReference Include="Microsoft.NET.Test.Sdk" Version="17.12.0" />
    <PackageReference Include="xunit" Version="2.9.2" />
    <PackageReference Include="xunit.runner.visualstudio" Version="2.8.2" />
  </ItemGroup>
</Project>
```

版は例で、採用するときにその版で対象のコントロールを操作できるかを小さく確かめる。`bin/` と `obj/` は QA リポジトリの `.gitignore` で除外されている。

デスクトップのテストは並列に流さない。xUnit ならアセンブリに次を書く。

```csharp
[assembly: CollectionBehavior(DisableTestParallelization = true)]
```

## 環境変数

テストにパスや URL を書かず、実行時に渡す。

| 変数 | 中身 |
|---|---|
| `QA_APP_EXE` | 起動する exe のパス。版の違う exe を差し替えて同じテストを流せるようにする |
| `QA_RUN_DIR` | `runs/<YYYYMMDD>-<run-id>` のパス。証跡は `$QA_RUN_DIR/evidence/<TC-ID>/` に書く |
| `QA_ENV` | アプリがサーバーにつながるときの環境名（プロファイルの `environments` の name） |

資格情報は、プロファイルの `roles` に名前がある環境変数から読む。値をテストのコードやログに書かない。

## 起動と終了

テストごとに、今回起動したプロセスだけを相手にする。既に動いている同じアプリのプロセスには接続しない。作業者が使っているインスタンスかもしれない。プロセスは自分で起動し、その `Process` のオブジェクトを最後まで持つ。PID から後で引き直すと、終了した後に同じ番号が別のプロセスに使われていることがある。

```csharp
public sealed class AppSession : IDisposable
{
    public static readonly TimeSpan Short = TimeSpan.FromSeconds(5);   // 代表のケースで測った値に余裕を足して決める
    public static readonly TimeSpan Launch = TimeSpan.FromSeconds(20);

    public Process Process { get; }
    public Application App { get; }
    public UIA3Automation Automation { get; } = new();
    public Window Main { get; }
    public string WorkDir { get; }      // %TEMP%\qa-desktop-<guid>。今回のテストが書いてよいのはこの下だけ
    public string OutDir { get; }       // WorkDir\out\<TC-ID>。保存のダイアログの保存先
    public string EvidenceDir { get; }  // $QA_RUN_DIR\evidence\<TC-ID>。最終の結果に残すものだけを写す
    public List<string> Problems { get; } = new();  // 終了できなかった、消せなかった、を result.md に書くために集める

    public AppSession(string tcId)
    {
        var exe = Environment.GetEnvironmentVariable("QA_APP_EXE") ?? throw new InvalidOperationException("QA_APP_EXE が未設定");
        var runDir = Environment.GetEnvironmentVariable("QA_RUN_DIR") ?? throw new InvalidOperationException("QA_RUN_DIR が未設定");
        EvidenceDir = Path.Combine(runDir, "evidence", tcId);
        Directory.CreateDirectory(EvidenceDir);

        WorkDir = Path.Combine(Path.GetTempPath(), "qa-desktop-" + Guid.NewGuid().ToString("N"));
        OutDir = Path.Combine(WorkDir, "out", tcId);
        Directory.CreateDirectory(OutDir);

        // 実行ファイルの横のデータを毎回初期の状態に戻すため、出力のフォルダを丸ごと写してから起動する
        var appDir = Path.Combine(WorkDir, "app");
        CopyTree(Path.GetDirectoryName(exe)!, appDir);
        Process = Process.Start(new ProcessStartInfo(Path.Combine(appDir, Path.GetFileName(exe)))
                      { UseShellExecute = false, WorkingDirectory = appDir })!;
        App = Application.Attach(Process.Id);   // Attach(Process) は渡した Process を使えなくする（FlaUI 5.0.0 で確かめた）
        Main = Retry.WhileNull(() => App.GetMainWindow(Automation, TimeSpan.FromSeconds(1)), Launch,
            throwOnTimeout: true, timeoutMessage: "メインウィンドウが開かない").Result!;
    }

    static void CopyTree(string from, string to)
    {
        Directory.CreateDirectory(to);
        foreach (var f in Directory.GetFiles(from)) File.Copy(f, Path.Combine(to, Path.GetFileName(f)));
        foreach (var d in Directory.GetDirectories(from)) CopyTree(d, Path.Combine(to, Path.GetFileName(d)));
    }

    public void Dispose()
    {
        if (!Process.HasExited)
        {
            App.Close(false);                   // ウィンドウを閉じる操作だけ。false で、閉じられなくても終了させない
            if (!Process.WaitForExit(5000))
            {
                // 終了させない。ダイアログや保存の途中かもしれない。状態を撮って作業者に伝える
                try { Capture.Element(Main).ToFile(Path.Combine(EvidenceDir, "zz-not-closed.png")); } catch { }
                Problems.Add($"PID {Process.Id} が閉じない。終了させずに残した");
            }
        }
        Automation.Dispose();
        if (Process.HasExited)
        {
            try { Directory.Delete(WorkDir, true); }
            catch (Exception e) { Problems.Add($"{WorkDir} を消せない: {e.Message}"); }
        }
        else Problems.Add($"{WorkDir} はプロセスが使っているので残した");
        foreach (var p in Problems) Console.Error.WriteLine("[AppSession] " + p);
    }
}
```

- 写して起動する方法は、アプリが実行ファイルの横のファイルからデータを読むときにだけ合う。サブフォルダ（言語ごとの `ja/`、`runtimes/`、プラグイン）があるので、フォルダを丸ごと写す。データをサーバーや `%APPDATA%` などに置くアプリでは、写しても初期の状態に戻らない。元の設定を退避して隔離したデータの場所を指す設定に差し替え、終了と例外のときに戻す。戻す処理は `Dispose` に書き、戻せたことを確かめる
- 隔離できない（作業者のインスタンスと設定やデータを共有してしまう）なら、そのアプリのテストは流さずに作業者に伝える
- FlaUI の `Application.Close()` は、引数を省くと閉じられなかったときにプロセスを終了させる。`Close(false)` を使い、閉じなければ終了させずに状態を撮って作業者に伝える。更新や出力の途中、保存していない変更がある、ということがある
- `Problems` に入ったもの（閉じなかったプロセス、消せなかったフォルダ）は、result.md の実行の条件と作業者への報告に書く。黙って捨てない
- 同じ名前のプロセスをまとめて終了させない。`Process.GetProcessesByName` で拾ったものを `Kill` する例を見かけるが、作業者のインスタンスまで落とす

## 流す前の確かめ

最初のケースの前に、GUI を操作できるデスクトップかを確かめる。ロックされた画面では、UIA のパターンの操作は通ることがあるのに、スクリーンショットにはロック画面が写り、キー入力は届かない。テストが緑のまま、使えない証跡が残る。

```csharp
[DllImport("user32.dll")] static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
[DllImport("user32.dll")] static extern bool CloseDesktop(IntPtr h);
[DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
const uint DESKTOP_SWITCHDESKTOP = 0x0100;

public static void AssertInteractive(AppSession s)
{
    if (Process.GetProcessesByName("LogonUI").Length > 0) throw new InvalidOperationException("画面がロックされている");
    var desk = OpenInputDesktop(0, false, DESKTOP_SWITCHDESKTOP);
    if (desk == IntPtr.Zero) throw new InvalidOperationException("入力のデスクトップに触れない（ロック中か別のセッション）");
    CloseDesktop(desk);
    s.Main.SetForeground();
    var ok = Retry.WhileFalse(() => { GetWindowThreadProcessId(GetForegroundWindow(), out var pid); return pid == (uint)s.Process.Id; },
                              AppSession.Short).Result;
    if (!ok) throw new InvalidOperationException("アプリのウィンドウが前面にならない");
}
```

- 失敗したら、そこで止める。残りのケースは実行不能（画面がロックされていた、前面にできなかった）にし、作業者に解除や空き時間を頼む。ロック画面を撮った画像を証跡にしない
- 前面の確かめは、撮影やキー入力の直前にも行う。途中で通知や他のウィンドウが前に出ることがある

## Quick Reference

| やりたいこと | 推奨する方法 | 避けるもの |
|---|---|---|
| 要素を探す | `FindFirstDescendant(cf => cf.ByAutomationId(id))`。名前で探すときは ControlType と組み合わせ、探す起点をアプリのウィンドウかダイアログにする | デスクトップ全体から名前だけで最初の要素を拾う |
| 要素が出るまで待つ | `Retry.WhileNull(..., timeout, throwOnTimeout: true, timeoutMessage: ...)` | 固定の `Thread.Sleep` |
| ボタンを押す | `element.AsButton().Invoke()` | 座標のクリック |
| 一覧や表の行を選ぶ | `AsGrid().Rows[i].Select()`、`AsListBoxItem().Select()`（SelectionItemPattern） | 座標のクリック |
| チェックボックス | `AsCheckBox().IsChecked = true`（TogglePattern） | 座標のクリック |
| 入力欄 | `AsTextBox().Text = value`（ValuePattern）。入れた後に読み返す | キーの連打 |
| メニュー | 項目を `AsMenuItem().Invoke()`。メニューを開くのにキーが要るときだけキー操作 | 項目までニーモニックで辿る |
| 所有ウィンドウのあるダイアログを待つ | 所有ウィンドウの子を先に探し、なければデスクトップ直下を同じ PID で探す（`dialogs.md`） | デスクトップ直下だけを探す |
| 同期で開くメッセージボックスを待つ | 操作を別のスレッドで発火し、Win32 の `EnumWindows` で検出する（下の節） | UIA で検出し続ける |
| ダイアログのタイトルや文言 | 呼び出し元のコード（`MessageBox.Show(...)` など）を検索して確かめる | 画面から推測した文字列 |
| 証跡を撮る | `Capture.Element(window).ToFile(path)` でアプリのウィンドウの範囲だけ | `Capture.Screen()` で全画面 |

UIA3 で扱えないコントロール（古い独自の描画のもの、一部のプラグイン）は、UIA2（`FlaUI.UIA2`）で見えるかを試す。それでも扱えなければ手動の確認項目に回し、理由を残す。

## 要素の調べ方

テストを書く前に、対象のウィンドウの UIA のツリーを見る。Windows SDK の Inspect か FlaUInspect で見るか、テストの中で子孫を名前、AutomationId、ControlType、クラス名の組で書き出す。書き出した結果は Git に入らない場所に置く。標準のダイアログのツリーには、作業者のフォルダの名前やファイルの一覧が入る。

- WinForms、WPF、標準のファイルダイアログで、ツリーの形は同じではない。WPF の `DataGrid` は Grid として見え、行は `Rows` で取れる。WinForms の `DataGridView` は `AsDataGridView()` を使う
- WPF の `TextBlock` は Text の要素になり、表示している文字が `Name` に入る
- AutomationId がない要素は、開発者に付けてもらうのが一番安定する。付けられないときは、親の AutomationId から辿る

## 操作が返らないとき

操作のイベントの中で同期のメッセージボックスを開く画面では、`Invoke()` や `Select()` がダイアログが閉じるまで返らないことがある。このとき、同じ `UIA3Automation` を使う他の呼び出し（デスクトップの列挙など）まで長く待たされることが報告されている。どの操作で起きるかはフレームワークとパターンで違う。WPF のボタンの `Invoke()` はすぐ返るが、行の `Select()` は選択の変更のイベントを同期で走らせる。WinForms のボタンの `Invoke()` は返らないことがある。疑わしい操作は、代表のケースで小さく確かめる。

返らない操作は、別のスレッドで発火して完了を待たず、ダイアログの検出を Win32 の API に切り替える。

```csharp
_ = Task.Run(() => { try { row.Select(); } catch { } });   // 発火だけ
var hWnd = Win32Windows.WaitOwned((uint)session.App.ProcessId, session.Main.Properties.NativeWindowHandle.Value,
                                  "<ダイアログのタイトル>", AppSession.Short);
var texts = Win32Windows.ChildTexts(hWnd, "Static");          // 本文
var buttons = Win32Windows.ChildTexts(hWnd, "Button");        // ボタンの文字
```

```csharp
using System.Runtime.InteropServices;
using System.Text;

static class Win32Windows
{
    delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, EnumProc cb, IntPtr lParam);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr hWnd, uint cmd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hWnd, StringBuilder s, int max);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr hWnd, StringBuilder s, int max);
    const uint GW_OWNER = 4;

    static string Text(IntPtr h) { var s = new StringBuilder(512); GetWindowText(h, s, s.Capacity); return s.ToString(); }
    static string Class(IntPtr h) { var s = new StringBuilder(256); GetClassName(h, s, s.Capacity); return s.ToString(); }

    // 対象の PID の、可視で、指定の所有ウィンドウを持つトップレベルのウィンドウをタイトルで探す
    public static IntPtr WaitOwned(uint pid, IntPtr owner, string title, TimeSpan timeout)
    {
        var end = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < end)
        {
            var found = IntPtr.Zero;
            EnumWindows((h, _) =>
            {
                GetWindowThreadProcessId(h, out var p);
                if (p == pid && IsWindowVisible(h) && GetWindow(h, GW_OWNER) == owner && Text(h) == title) { found = h; return false; }
                return true;
            }, IntPtr.Zero);
            if (found != IntPtr.Zero) return found;
            Thread.Sleep(100);
        }
        throw new TimeoutException("ダイアログが出ない: " + title);
    }

    public static List<string> ChildTexts(IntPtr parent, string className)
    {
        var list = new List<string>();
        EnumChildWindows(parent, (h, _) => { if (Class(h) == className) list.Add(Text(h)); return true; }, IntPtr.Zero);
        return list;
    }
}
```

閉じるボタンも、UIA が返らない間は Win32 で押す（ボタンのハンドルに `BM_CLICK` を送る）。発火したタスクは放置しない。ダイアログを閉じた後、元の操作が終わったこと（タスクの完了、画面の状態）を期限付きで確かめる。確かめられなければ、そのインスタンスで次のケースに進まず、ケースを止める。期限切れの後に元の操作が遅れて届き、二重の保存や二重の更新になることがある。

## 待ち方とタイムアウト

- 操作の後は、ウィンドウが出た・閉じた、ボタンが有効になった、ステータスの文字が変わった、ファイルが書き終わった、という観測できる条件を期限付きで待つ。`Invoke()` が例外なく返ったことを成功にしない
- 期限は、代表のケースで実際にかかった時間に余裕を足して決め、決めた値と根拠を result.md の実行の条件に書く。長すぎる期限を一律に使うと、失敗の発見が遅れて PC の占有が延びる
- `Retry.WhileFalse` は既定では期限が来ても例外を出さない。待った後に、待っていた条件そのものをアサートする
- 期限切れは、テストのコードの待ち方の不足か、アプリの応答がないかのどちらかである。ダイアログが出たままなら、その画像を撮ってから判断する

## UIA で操作できないとき

パターンで操作できない場合だけ、対象のウィンドウを前面にしてキー入力やマウスの操作をする。

- 送る前に、前面のウィンドウが対象の PID のウィンドウかを毎回確かめる。フォーカスが他のアプリに移ったら送るのをやめる
- 座標は対象の要素の `BoundingRectangle` から求め、画面の固定の座標を使わない
- キー入力とマウスの操作は、画面がロックされていると届かない。UIA のパターンによる操作はロック中でも通ることがあるので、テストが通っても、キー入力を使う部分は確かめられていない場合がある
- クリップボードに秘密の値を置かない

## マルチモニターと DPI

- 副のモニターが主のモニターの左や上にあると、座標が負になる。座標のクリックはここでずれやすい。パターンの操作を使う
- 実行した PC のモニターの構成（解像度、位置、表示倍率）を result.md の実行の条件に書く。画像を比べる環境どうしでは、表示倍率とウィンドウの大きさをそろえる
- そろえるために、作業者のウィンドウを勝手に動かしたり、表示の設定を変えたりしない。変える必要があれば作業者に頼む

## 証跡の撮り方

```csharp
public string Shot(string checkpoint, AutomationElement? element = null)
{
    var path = Path.Combine(EvidenceDir, checkpoint + ".png");
    Capture.Element(element ?? Main).ToFile(path);
    return path;
}
```

- `Capture.Element` は、要素の範囲の画面の画素を写す。上に他のウィンドウや通知が重なっていればそれが写り、画面がロックされていればロック画面が写る。撮る前に対象のウィンドウが前面で、重なりがないことを確かめ、撮った画像は開いて見る
- ダイアログを撮るときは、ダイアログの要素を渡す。本体とダイアログの両方を写したいときは、それぞれを撮る
- 画面に出た値（表の行、ステータスの文字、ダイアログの本文）は、画像とは別に `<checkpoint>.values.json` に書く。画像だけでは後で値を比べられない
- 撮影は判定のアサートより先に書く。判定を先にすると、失敗したときの画面が残らない

## Common Mistakes

- 座標の `.Click()` を使う。マルチモニター（特に座標が負の副のモニター）や表示倍率の違いでずれる。`Invoke()`、`Select()`、`IsChecked` などのパターンを使う
- ダイアログのタイトルを、コードを確かめずに推測で使う。本文とタイトルを取り違えたり、実際の文言と違ったりして、期限切れになる。`MessageBox.Show(...)` の呼び出し元を検索する
- メッセージボックスのタイトルがアプリの本体のウィンドウと同じことを忘れ、本体をダイアログと取り違える。本体のハンドルを除くか、所有ウィンドウの子から探す
- ダイアログの中で AutomationId だけで探す。標準のファイルダイアログでは、保存の `1` やキャンセルの `2` がファイルの一覧の項目の AutomationId と重なる。ControlType と組み合わせる
- NG を消すためにテストのコードを動かして緑にする。テストのコードの不具合（セレクタ、待ち方）を直すのはよいが、期待値を実装に合わせて変えない。NG は再現手順と証跡を付けて報告する
- `Process.GetProcessesByName` で拾った同じ名前のプロセスをまとめて終了させる
- `Capture.Screen()` で全画面を撮り、他のアプリの画面や通知を証跡に入れる
