using CommunityToolkit.Mvvm.ComponentModel;

namespace StellarisModManager.UI.ViewModels;

public partial class InstallQueueItemViewModel : ObservableObject
{
    public InstallQueueItemViewModel(string modId)
    {
        ModId = modId;
        _displayName = $"Mod {modId}";
    }

    public string ModId { get; }

    [ObservableProperty] private string _displayName;
    [ObservableProperty] private string _stage = "Queued";
    [ObservableProperty] private int _progress;
    [ObservableProperty] private bool _isActive;
}
