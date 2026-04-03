using Avalonia.Controls;
using Avalonia.Interactivity;

namespace StellarisModManager.UI.Views;

public partial class UpdateAvailablePromptWindow : Window
{
    public UpdateAvailablePromptWindow()
    {
        InitializeComponent();
    }

    public UpdateAvailablePromptWindow(string versionMsg) : this()
    {
        var textBlock = this.FindControl<TextBlock>("UpdateVersionText");
        if (textBlock != null) textBlock.Text = versionMsg;
    }

    private void LaterButton_Click(object? sender, RoutedEventArgs e)
    {
        Close((false, SkipPromptCheckBox.IsChecked == true));
    }

    private void InstallButton_Click(object? sender, RoutedEventArgs e)
    {
        Close((true, false));
    }
}
