using Avalonia;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Markup.Xaml;
using System;
using System.Threading.Tasks;
using StellarisModManager.UI.Views;

namespace StellarisModManager;

public partial class App : Application
{
    public override void Initialize()
    {
        AvaloniaXamlLoader.Load(this);
    }

    public override void OnFrameworkInitializationCompleted()
    {
        if (ApplicationLifetime is IClassicDesktopStyleApplicationLifetime desktop)
        {
            var splash = new SplashWindow();
            desktop.MainWindow = splash;
            splash.Show();
            _ = ShowMainWindowAfterSplashAsync(desktop, splash);
        }

        base.OnFrameworkInitializationCompleted();
    }

    private static async Task ShowMainWindowAfterSplashAsync(IClassicDesktopStyleApplicationLifetime desktop, SplashWindow splash)
    {
        try
        {
            // Keep splash visible a bit longer for a smoother startup experience.
            await Task.Delay(1500);

            var mainWindow = new MainWindow();
            desktop.MainWindow = mainWindow;
            mainWindow.Show();
        }
        catch (Exception)
        {
            // Ensure startup failures do not leave the app without a window.
            if (desktop.MainWindow is null)
                desktop.MainWindow = new MainWindow();
        }
        finally
        {
            if (splash.IsVisible)
                splash.Close();
        }
    }
}
