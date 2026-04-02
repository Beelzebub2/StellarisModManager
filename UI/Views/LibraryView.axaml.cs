using System;
using System.Collections.Generic;
using Avalonia.Controls;
using Avalonia.Interactivity;
using Avalonia.Platform.Storage;
using StellarisModManager.UI.ViewModels;

namespace StellarisModManager.UI.Views;

public partial class LibraryView : UserControl
{
    private LibraryViewModel? _vm;
    private bool _handlersWired;

    public LibraryView()
    {
        InitializeComponent();
        DataContextChanged += OnDataContextChanged;
    }

    private void OnDataContextChanged(object? sender, EventArgs e)
    {
        if (_vm is not null)
            _vm.ShareIdCopiedRequested -= OnShareIdCopiedRequested;

        _vm = DataContext as LibraryViewModel;

        if (_vm is not null)
            _vm.ShareIdCopiedRequested += OnShareIdCopiedRequested;
    }

    // ------------------------------------------------------------------
    // Export / Import with file dialogs
    // ------------------------------------------------------------------

    protected override void OnLoaded(RoutedEventArgs e)
    {
        base.OnLoaded(e);
        _vm = DataContext as LibraryViewModel;

        if (_handlersWired)
            return;

        // Wire Export button
        var exportBtn = this.FindControl<Button>("ExportButton");
        if (exportBtn is not null)
            exportBtn.Click += ExportButton_Click;

        // Wire Import button
        var importBtn = this.FindControl<Button>("ImportButton");
        if (importBtn is not null)
            importBtn.Click += ImportButton_Click;

        _handlersWired = true;
    }

    private async void ExportButton_Click(object? sender, RoutedEventArgs e)
    {
        if (_vm is null) return;

        var topLevel = TopLevel.GetTopLevel(this);
        if (topLevel is null) return;

        var files = await topLevel.StorageProvider.SaveFilePickerAsync(new FilePickerSaveOptions
        {
            Title = "Export Mod List",
            SuggestedFileName = "stellaris-mods-export.json",
            DefaultExtension = "json",
            FileTypeChoices = new List<FilePickerFileType>
            {
                new FilePickerFileType("JSON files") { Patterns = new[] { "*.json" } },
                new FilePickerFileType("All files")  { Patterns = new[] { "*.*" } }
            }
        });

        if (files is null) return;

        var path = files.TryGetLocalPath();
        if (!string.IsNullOrWhiteSpace(path))
            await _vm.ExportModListToPathAsync(path);
    }

    private async void ImportButton_Click(object? sender, RoutedEventArgs e)
    {
        if (_vm is null) return;

        var topLevel = TopLevel.GetTopLevel(this);
        if (topLevel is null) return;

        var files = await topLevel.StorageProvider.OpenFilePickerAsync(new FilePickerOpenOptions
        {
            Title = "Import Mod List",
            AllowMultiple = false,
            FileTypeFilter = new List<FilePickerFileType>
            {
                new FilePickerFileType("JSON files") { Patterns = new[] { "*.json" } },
                new FilePickerFileType("All files")  { Patterns = new[] { "*.*" } }
            }
        });

        if (files is null || files.Count == 0) return;

        var path = files[0].TryGetLocalPath();
        if (!string.IsNullOrWhiteSpace(path))
            await _vm.ImportModListFromPathAsync(path);
    }

    private async void OnShareIdCopiedRequested(object? sender, string sharedId)
    {
        var topLevel = TopLevel.GetTopLevel(this);
        if (topLevel?.Clipboard is null || string.IsNullOrWhiteSpace(sharedId))
            return;

        try
        {
            await topLevel.Clipboard.SetTextAsync(sharedId);
        }
        catch
        {
            // Clipboard copy is best effort.
        }
    }
}
