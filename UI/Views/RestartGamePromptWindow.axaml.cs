using Avalonia.Controls;
using Avalonia.Interactivity;

namespace StellarisModManager.UI.Views;

public partial class RestartGamePromptWindow : Window
{
    public RestartGamePromptWindow()
    {
        InitializeComponent();
    }

    private void CancelButton_Click(object? sender, RoutedEventArgs e)
    {
        Close((false, false));
    }

    private void RestartButton_Click(object? sender, RoutedEventArgs e)
    {
        var skipPrompt = SkipPromptCheckBox.IsChecked == true;
        Close((true, skipPrompt));
    }
}
