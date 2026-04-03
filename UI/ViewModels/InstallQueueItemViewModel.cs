using System;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;

namespace StellarisModManager.UI.ViewModels;

public partial class InstallQueueItemViewModel : ObservableObject
{
    private readonly Action<string>? _cancelRequested;

    public InstallQueueItemViewModel(string modId, Action<string>? cancelRequested = null)
    {
        ModId = modId;
        _displayName = $"Mod {modId}";
        _cancelRequested = cancelRequested;
    }

    public string ModId { get; }

    [ObservableProperty] private string _displayName;
    [ObservableProperty] private string _stage = "Queued";
    [ObservableProperty] private int _progress;
    [ObservableProperty] private bool _isActive;
    [ObservableProperty] private bool _canCancel;

    [RelayCommand]
    private void Cancel()
    {
        if (!CanCancel)
            return;

        _cancelRequested?.Invoke(ModId);
    }
}
