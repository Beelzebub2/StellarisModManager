using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Interactivity;
using StellarisModManager.UI.ViewModels;

namespace StellarisModManager.UI.Views;

public partial class VersionBrowserView : UserControl
{
    public VersionBrowserView()
    {
        InitializeComponent();
        Loaded += OnLoaded;
    }

    private async void OnLoaded(object? sender, RoutedEventArgs e)
    {
        if (DataContext is VersionBrowserViewModel vm)
            await vm.LoadAsync();
    }

    private void OnCardActionClick(object? sender, RoutedEventArgs e)
    {
        if (sender is not Button button)
            return;

        if (button.DataContext is not VersionModCard card)
            return;

        if (DataContext is not VersionBrowserViewModel vm)
            return;

        if (vm.ToggleInstallCommand.CanExecute(card))
            vm.ToggleInstallCommand.Execute(card);
    }

    private void OnCardActionPointerEntered(object? sender, PointerEventArgs e)
    {
        if (sender is not Button button)
            return;

        if (button.DataContext is VersionModCard card)
            card.IsActionHovered = true;
    }

    private void OnCardActionPointerExited(object? sender, PointerEventArgs e)
    {
        if (sender is not Button button)
            return;

        if (button.DataContext is VersionModCard card)
            card.IsActionHovered = false;
    }
}
