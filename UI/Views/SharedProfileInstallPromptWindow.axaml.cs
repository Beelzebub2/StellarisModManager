using Avalonia.Controls;
using Avalonia.Interactivity;

namespace StellarisModManager.UI.Views;

public partial class SharedProfileInstallPromptWindow : Window
{
    public SharedProfileInstallPromptWindow()
    {
        InitializeComponent();
    }

    public SharedProfileInstallPromptWindow(string promptMessage) : this()
    {
        var promptText = this.FindControl<TextBlock>("PromptText");
        if (promptText is not null)
            promptText.Text = promptMessage;
    }

    private void CancelButton_Click(object? sender, RoutedEventArgs e)
    {
        Close(false);
    }

    private void InstallButton_Click(object? sender, RoutedEventArgs e)
    {
        Close(true);
    }
}
