using System.Collections.ObjectModel;
using System.IO;
using System.Text;
using System.Windows;
using System.Windows.Controls;
using Microsoft.Win32;

namespace SampleStock;

public record StockItem(string Name, string Quantity, string Location);

public partial class MainWindow : Window
{
    private const string Header = "品名,数量,置き場所";
    private readonly ObservableCollection<StockItem> items = new();

    public MainWindow()
    {
        InitializeComponent();
        LoadInitialData();
        StockGrid.ItemsSource = items;
        StockGrid.SelectedIndex = -1;
        StatusText.Text = "";
    }

    private void LoadInitialData()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "stock.csv");
        if (!File.Exists(path)) return;
        foreach (var line in File.ReadAllLines(path, Encoding.UTF8).Skip(1))
        {
            if (string.IsNullOrWhiteSpace(line)) continue;
            var cells = line.Split(',');
            if (cells.Length < 3) continue;
            items.Add(new StockItem(cells[0], cells[1], cells[2]));
        }
    }

    private void OnSelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        StatusText.Text = StockGrid.SelectedItem is StockItem item ? "選択中: " + item.Name : "";
    }

    private static string Escape(string value) =>
        value.IndexOfAny(new[] { ',', '"', '\r', '\n' }) >= 0 ? "\"" + value.Replace("\"", "\"\"") + "\"" : value;

    private void OnSave(object sender, RoutedEventArgs e)
    {
        var dialog = new SaveFileDialog
        {
            FileName = "stock.csv",
            DefaultExt = ".csv",
            Filter = "CSV ファイル (*.csv)|*.csv",
        };
        if (dialog.ShowDialog(this) != true) return;

        var lines = new List<string> { Header };
        lines.AddRange(items.Select(i => string.Join(",", Escape(i.Name), Escape(i.Quantity), Escape(i.Location))));
        File.WriteAllLines(dialog.FileName, lines, new UTF8Encoding(false));
        StatusText.Text = "保存しました";
    }

    private void OnDelete(object sender, RoutedEventArgs e)
    {
        if (StockGrid.SelectedItem is not StockItem item)
        {
            MessageBox.Show(this, "削除する行を選んでください", "在庫一覧", MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }
        var answer = MessageBox.Show(this, "この在庫を削除しますか", "在庫一覧", MessageBoxButton.YesNo, MessageBoxImage.Question);
        if (answer == MessageBoxResult.Yes) items.Remove(item);
    }
}
