using System;
using System.Collections.Generic;
using System.Text.Json;
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

    /// <summary>Returns "Update available" when HasUpdate is true, empty string otherwise.</summary>
    public string HasUpdateText => HasUpdate ? "Update available" : string.Empty;

    /// <summary>Returns "MP Safe" badge text when the mod is multiplayer-safe.</summary>
    public string MultiplayerSafeLabel => IsMultiplayerSafe ? "MP Safe" : string.Empty;

    /// <summary>Whether the multiplayer-safe badge should be visible.</summary>
    public bool IsMultiplayerSafeVisible => IsMultiplayerSafe;

    /// <summary>Workshop URL for this mod (empty if no workshop ID).</summary>
    public string WorkshopUrl => string.IsNullOrWhiteSpace(WorkshopId)
        ? string.Empty
        : $"https://steamcommunity.com/sharedfiles/filedetails/?id={WorkshopId}";

    /// <summary>List of tags parsed from the JSON tags string.</summary>
    public List<string> TagsList
    {
        get
        {
            if (string.IsNullOrWhiteSpace(Model.Tags))
                return new List<string>();
            try
            {
                return JsonSerializer.Deserialize<List<string>>(Model.Tags) ?? new List<string>();
            }
            catch
            {
                return new List<string>();
            }
        }
    }

    /// <summary>Comma-separated tags for display.</summary>
    public string TagsDisplay => string.Join(", ", TagsList);

    public ModViewModel(Mod mod, ModDatabase db)
    {
        Model = mod;
        _db = db;
        _isEnabled = mod.IsEnabled;
        _loadOrder = mod.LoadOrder;
        _hasUpdate = false;
    }

    partial void OnHasUpdateChanged(bool value) => OnPropertyChanged(nameof(HasUpdateText));
    partial void OnIsEnabledChanged(bool value) => Model.IsEnabled = value;

    // Persists the current checkbox value to the database.
    [RelayCommand]
    private async Task ToggleEnabledAsync()
    {
        await _db.SetModEnabledAsync(Model.Id, IsEnabled);
    }
}
