using Avalonia.Controls;
using Avalonia.Interactivity;

namespace StellarisModManager.UI.Views;

public partial class PublicUsernamePromptWindow : Window
{
    public PublicUsernamePromptWindow()
    {
        InitializeComponent();

        Opened += (_, _) =>
        {
            UsernameTextBox?.Focus();
            UsernameTextBox?.SelectAll();
        };
    }

    private void CancelButton_Click(object? sender, RoutedEventArgs e)
    {
        Close(null);
    }

    private void SaveButton_Click(object? sender, RoutedEventArgs e)
    {
        var username = UsernameTextBox?.Text?.Trim() ?? string.Empty;
        if (string.IsNullOrWhiteSpace(username))
        {
            if (ValidationText is not null)
                ValidationText.IsVisible = true;

            UsernameTextBox?.Focus();
            return;
        }

        if (ValidationText is not null)
            ValidationText.IsVisible = false;

        Close(username);
    }
}
