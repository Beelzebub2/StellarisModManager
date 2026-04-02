namespace StellarisModManager.Core.Models;

/// <summary>
/// Stellaris game installation info.
/// </summary>
public class GameInstall
{
    public int Id { get; set; }
    public string GamePath { get; set; } = string.Empty;   // path to Stellaris.exe
    public string ModsPath { get; set; } = string.Empty;   // Documents/Paradox Interactive/Stellaris/mod/
    public string GameVersion { get; set; } = string.Empty; // detected game version
    public string? SteamCmdPath { get; set; }              // path to steamcmd.exe
    public string? SteamCmdDownloadPath { get; set; }      // where steamcmd downloads to
}
