using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Markup.Xaml;
using Avalonia.Threading;
using System;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using StellarisModManager.UI.Views;

namespace StellarisModManager;

public partial class App : Application
{
    private static int _showingFatalErrorWindow;
    private static int _globalHandlersAttached;

    public override void Initialize()
    {
        AvaloniaXamlLoader.Load(this);
    }

    public override void OnFrameworkInitializationCompleted()
    {
        if (ApplicationLifetime is IClassicDesktopStyleApplicationLifetime desktop)
        {
            AttachGlobalExceptionHandlers(desktop);

            try
            {
                var splash = new SplashWindow();
                desktop.MainWindow = splash;
                splash.Show();
                _ = ShowMainWindowAfterSplashAsync(desktop, splash);
            }
            catch (Exception ex)
            {
                ShowStartupErrorWindow(desktop, ex, "Failed to initialize splash window.");
            }
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
        catch (Exception ex)
        {
            ShowStartupErrorWindow(desktop, ex, "Main window failed to initialize.");
        }
        finally
        {
            if (splash.IsVisible)
                splash.Close();
        }
    }

    private static void AttachGlobalExceptionHandlers(IClassicDesktopStyleApplicationLifetime desktop)
    {
        if (Interlocked.Exchange(ref _globalHandlersAttached, 1) == 1)
            return;

        Dispatcher.UIThread.UnhandledException += (_, e) =>
        {
            ShowUnhandledErrorWindow(desktop, e.Exception, "Unhandled UI exception.");
            e.Handled = true;
        };

        AppDomain.CurrentDomain.UnhandledException += (_, e) =>
        {
            var ex = e.ExceptionObject as Exception
                ?? new Exception($"Non-exception unhandled object: {e.ExceptionObject}");

            ShowUnhandledErrorWindow(desktop, ex, "Unhandled application exception.");
        };

        TaskScheduler.UnobservedTaskException += (_, e) =>
        {
            var baseException = e.Exception.GetBaseException();
            if (baseException is OperationCanceledException ||
                baseException is ObjectDisposedException)
            {
                e.SetObserved();
                return;
            }

            ShowUnhandledErrorWindow(desktop, e.Exception, "Unobserved task exception.");
            e.SetObserved();
        };
    }

    private static void ShowUnhandledErrorWindow(IClassicDesktopStyleApplicationLifetime desktop, Exception ex, string context)
    {
        if (Interlocked.Exchange(ref _showingFatalErrorWindow, 1) == 1)
            return;

        void ShowCore()
        {
            try
            {
                ShowStartupErrorWindow(desktop, ex, context);
            }
            finally
            {
                Interlocked.Exchange(ref _showingFatalErrorWindow, 0);
            }
        }

        if (Dispatcher.UIThread.CheckAccess())
            ShowCore();
        else
            Dispatcher.UIThread.Post(ShowCore);
    }

    private static void ShowStartupErrorWindow(IClassicDesktopStyleApplicationLifetime desktop, Exception ex, string context)
    {
        var logPath = WriteStartupErrorLog(ex, context);
        var message =
            "Stellaris Mod Manager encountered an error.\n\n" +
            context + "\n\n" +
            ex.Message + "\n\n" +
            "A diagnostic log was written to:\n" +
            logPath;

        try
        {
            var errorWindow = new Window
            {
                Title = "Application Error",
                Width = 760,
                Height = 460,
                MinWidth = 640,
                MinHeight = 320,
                WindowStartupLocation = WindowStartupLocation.CenterScreen,
                Content = new TextBox
                {
                    Text = message,
                    IsReadOnly = true,
                    AcceptsReturn = true,
                    TextWrapping = Avalonia.Media.TextWrapping.Wrap,
                    Margin = new Thickness(14)
                }
            };

            desktop.MainWindow = errorWindow;
            errorWindow.Show();
        }
        catch
        {
            // Last-resort fallback: keep process alive long enough for debuggers/log readers.
            desktop.Shutdown(-1);
        }
    }

    private static string WriteStartupErrorLog(Exception ex, string context)
    {
        try
        {
            var dir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "StellarisModManager");

            Directory.CreateDirectory(dir);

            var path = Path.Combine(dir, "startup-error.log");
            var text =
                $"[{DateTime.UtcNow:O}] {context}{Environment.NewLine}" +
                ex +
                Environment.NewLine +
                Environment.NewLine;

            File.AppendAllText(path, text);
            return path;
        }
        catch
        {
            return "(could not write startup log)";
        }
    }
}
