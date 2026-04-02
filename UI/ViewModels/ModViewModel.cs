using System;
using System.Threading.Tasks;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using StellarisModManager.Core.Models;
using StellarisModManager.Core.Services;

namespace StellarisModManager.UI.ViewModels;

// Wraps a Mod model for display in the library
public partial class ModViewModel : ViewModelBase
{
    private readonly ModDatabase _db;

    public Mod Model { get; }

    [ObservableProperty] private bool _isEnabled;
    [ObservableProperty] private int _loadOrder;
    [ObservableProperty] private bool _hasUpdate;

    public string Name => Model.Name;
    public string Version => !string.IsNullOrWhiteSpace(Model.Version) ? Model.Version : "Unknown";
    public string WorkshopId => Model.SteamWorkshopId;
    public bool IsMultiplayerSafe => Model.IsMultiplayerSafe;
    public string? GameVersion => Model.GameVersion;
    public string InstalledDate => Model.InstalledAt.ToString("yyyy-MM-dd");

    public ModViewModel(Mod mod, ModDatabase db)
    {
        Model = mod;
        _db = db;
        _isEnabled = mod.IsEnabled;
        _loadOrder = mod.LoadOrder;
        _hasUpdate = false;
    }

    // Toggle enabled/disabled - updates DB
    [RelayCommand]
    private async Task ToggleEnabledAsync()
    {
        IsEnabled = !IsEnabled;
        Model.IsEnabled = IsEnabled;
        await _db.SetModEnabledAsync(Model.Id, IsEnabled);
    }
}
