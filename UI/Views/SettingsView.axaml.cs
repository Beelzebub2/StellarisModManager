using Avalonia.Controls;
using Avalonia.Interactivity;
using Avalonia.Platform.Storage;
using System;
using System.Collections.Generic;
using System.Linq;
using StellarisModManager.UI.ViewModels;

namespace StellarisModManager.UI.Views;

public partial class SettingsView : UserControl
{
    private SettingsViewModel? _vm;
    private bool _handlersWired;

    public SettingsView()
    {
        InitializeComponent();
        DataContextChanged += OnDataContextChanged;
    }

    private void OnDataContextChanged(object? sender, EventArgs e)
    {
        _vm = DataContext as SettingsViewModel;
    }

    protected override void OnLoaded(RoutedEventArgs e)
    {
        base.OnLoaded(e);
        _vm = DataContext as SettingsViewModel;

        if (_handlersWired)
            return;

        var browseGamePathBtn = this.FindControl<Button>("BrowseGamePathButton");
        if (browseGamePathBtn is not null)
            browseGamePathBtn.Click += BrowseGamePathButton_Click;

        var browseModsPathBtn = this.FindControl<Button>("BrowseModsPathButton");
        if (browseModsPathBtn is not null)
            browseModsPathBtn.Click += BrowseModsPathButton_Click;

        var browseSteamCmdPathBtn = this.FindControl<Button>("BrowseSteamCmdPathButton");
        if (browseSteamCmdPathBtn is not null)
            browseSteamCmdPathBtn.Click += BrowseSteamCmdPathButton_Click;

        var browseSteamCmdDownloadPathBtn = this.FindControl<Button>("BrowseSteamCmdDownloadPathButton");
        if (browseSteamCmdDownloadPathBtn is not null)
            browseSteamCmdDownloadPathBtn.Click += BrowseSteamCmdDownloadPathButton_Click;

        _handlersWired = true;
    }

    private async void BrowseGamePathButton_Click(object? sender, RoutedEventArgs e)
    {
        var topLevel = TopLevel.GetTopLevel(this);
        if (topLevel is null || _vm is null)
            return;

        var selected = await PickFolderAsync(topLevel, "Select Stellaris installation folder");
        if (!string.IsNullOrWhiteSpace(selected))
            _vm.SetGamePath(selected);
    }

    private async void BrowseModsPathButton_Click(object? sender, RoutedEventArgs e)
    {
        var topLevel = TopLevel.GetTopLevel(this);
        if (topLevel is null || _vm is null)
            return;

        var selected = await PickFolderAsync(topLevel, "Select Stellaris mods folder");
        if (!string.IsNullOrWhiteSpace(selected))
            _vm.SetModsPath(selected);
    }

    private async void BrowseSteamCmdDownloadPathButton_Click(object? sender, RoutedEventArgs e)
    {
        var topLevel = TopLevel.GetTopLevel(this);
        if (topLevel is null || _vm is null)
            return;

        var selected = await PickFolderAsync(topLevel, "Select SteamCMD download/workshop cache folder");
        if (!string.IsNullOrWhiteSpace(selected))
            _vm.SetSteamCmdDownloadPath(selected);
    }

    private async void BrowseSteamCmdPathButton_Click(object? sender, RoutedEventArgs e)
    {
        var topLevel = TopLevel.GetTopLevel(this);
        if (topLevel is null || _vm is null)
            return;

        var files = await topLevel.StorageProvider.OpenFilePickerAsync(new FilePickerOpenOptions
        {
            Title = "Select steamcmd.exe",
            AllowMultiple = false,
            FileTypeFilter = new List<FilePickerFileType>
            {
                new("Executable") { Patterns = new[] { "*.exe" } },
                new("All files") { Patterns = new[] { "*.*" } }
            }
        });

        var path = files.FirstOrDefault()?.TryGetLocalPath();
        if (!string.IsNullOrWhiteSpace(path))
            _vm.SetSteamCmdPath(path);
    }

    private static async System.Threading.Tasks.Task<string?> PickFolderAsync(TopLevel topLevel, string title)
    {
        var folders = await topLevel.StorageProvider.OpenFolderPickerAsync(new FolderPickerOpenOptions
        {
            Title = title,
            AllowMultiple = false
        });

        return folders.FirstOrDefault()?.TryGetLocalPath();
    }
}
