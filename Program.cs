using Avalonia;
using Avalonia.WebView.Desktop;
using System;

namespace StellarisModManager;

internal sealed class Program
{
    // Initialization code. Don't use any Avalonia, third-party APIs or any
    // SynchronizationContext-reliant code before AppMain is called: things aren't initialized
    // yet and stuff might break.
    [STAThread]
    public static void Main(string[] args)
    {
        var existingArgs = Environment.GetEnvironmentVariable("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS");
        const string compatibilityFlag = "--disable-gpu";

        if (string.IsNullOrWhiteSpace(existingArgs))
        {
            Environment.SetEnvironmentVariable("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", compatibilityFlag);
        }
        else if (!existingArgs.Contains(compatibilityFlag, StringComparison.OrdinalIgnoreCase))
        {
            Environment.SetEnvironmentVariable("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", existingArgs + " " + compatibilityFlag);
        }

        BuildAvaloniaApp().StartWithClassicDesktopLifetime(args);
    }

    // Avalonia configuration, don't remove; also used by visual designer.
    public static AppBuilder BuildAvaloniaApp()
        => AppBuilder.Configure<App>()
            .UsePlatformDetect()
            .WithInterFont()
            .LogToTrace()
            .UseDesktopWebView();   // WebView.Avalonia.Desktop — enables WebView2 on Windows
}
