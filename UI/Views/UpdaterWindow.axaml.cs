using System;
using System.Diagnostics;
using System.Threading;
using System.Threading.Tasks;
using Avalonia.Controls;
using Avalonia.Interactivity;
using Avalonia.Media;
using StellarisModManager.Core.Services;

namespace StellarisModManager.UI.Views;

public partial class UpdaterWindow : Window
{
    private BackgroundUpdateRequest _request = new();
    private bool _hasValidRequest;
    private CancellationTokenSource _runCts = new();

    private Process? _installerProcess;
    private bool _isRunActive;
    private bool _isRetryMode;
    private bool _scheduledCleanup;

    public UpdaterWindow()
    {
        InitializeComponent();

        RetryButton.Click += RetryButton_Click;
        CancelButton.Click += CancelButton_Click;

        Opened += OnOpened;
        Closing += OnClosing;
    }

    public UpdaterWindow(BackgroundUpdateRequest request)
        : this()
    {
        _request = request;
        _hasValidRequest = true;

        var target = string.IsNullOrWhiteSpace(request.TargetVersion)
            ? "unknown version"
            : $"v{request.TargetVersion}";
        TargetVersionText.Text = $"Target: {target}";
    }

    private async void OnOpened(object? sender, EventArgs e)
    {
        if (!_hasValidRequest)
        {
            SetStep("Failed", "Updater launch request is missing.", 0);
            StatusChip.Text = "Failed";
            RetryButton.IsVisible = false;
            CancelButton.Content = "Close";
            _isRetryMode = true;
            return;
        }

        await RunUpdateFlowAsync(waitForParentExit: true);
    }

    private async Task RunUpdateFlowAsync(bool waitForParentExit)
    {
        _isRunActive = true;
        RetryButton.IsVisible = false;
        CancelButton.Content = "Cancel";
        StatusChip.Text = "Running";
        StatusChip.Foreground = new SolidColorBrush(Color.Parse("#9CA6B7"));

        try
        {
            if (waitForParentExit)
            {
                SetStep("Closing app", "Waiting for app process to close...", 10);
                BackgroundUpdaterRuntime.WriteStatus("closing", "Waiting for app to close.", _request.TargetVersion, false);

                await BackgroundUpdaterRuntime.WaitForParentExitAsync(
                    _request,
                    _runCts.Token,
                    percent =>
                    {
                        var bounded = Math.Clamp(percent, 0, 100);
                        var mapped = 8 + (bounded / 8);
                        Progress.Value = mapped;
                    });
            }

            if (_runCts.Token.IsCancellationRequested)
            {
                HandleCancelled();
                return;
            }

            await RunInstallerStageAsync();
        }
        catch (OperationCanceledException)
        {
            HandleCancelled();
        }
        catch (Exception ex)
        {
            HandleFailed($"Updater error: {ex.Message}");
        }
        finally
        {
            _isRunActive = false;
        }
    }

    private async Task RunInstallerStageAsync()
    {
        var installerLogPath = BackgroundUpdaterRuntime.GetInstallerLogPath(_request);
        SetStep("Installing in background", "Launching silent installer...", 25);
        BackgroundUpdaterRuntime.WriteStatus("installing", "Running installer in background.", _request.TargetVersion, false);

        _installerProcess = BackgroundUpdaterRuntime.StartInstallerProcess(_request, installerLogPath);
        if (_installerProcess is null)
        {
            HandleFailed("Could not start installer process.");
            return;
        }

        var installStartedAt = DateTimeOffset.UtcNow;

        while (!_installerProcess.HasExited)
        {
            if (_runCts.Token.IsCancellationRequested)
            {
                TryTerminateInstallerProcess();
                HandleCancelled();
                return;
            }

            var estimated = BackgroundUpdaterRuntime.EstimateInstallerProgressPercent(installerLogPath, installStartedAt);
            Progress.Value = estimated;
            DetailsText.Text = $"Installing silently in background... {estimated}%";

            await Task.Delay(350, _runCts.Token);
        }

        var exitCode = _installerProcess.ExitCode;
        _installerProcess.Dispose();
        _installerProcess = null;

        if (exitCode != 0)
        {
            HandleFailed($"Installer failed with exit code {exitCode}. Check installer-run.log and retry.");
            return;
        }

        SetStep("Verifying install", "Validating installation and preparing relaunch...", 92);
        BackgroundUpdaterRuntime.WriteStatus("verifying", "Verifying updated installation.", _request.TargetVersion, false);
        await Task.Delay(450, _runCts.Token);

        SetStep("Relaunching", "Starting updated app...", 100);
        var relaunched = BackgroundUpdaterRuntime.TryStartMainApp(_request.AppExePath);

        if (!relaunched)
        {
            HandleFailed("Update installed, but relaunch failed. Start the app manually.");
            return;
        }

        BackgroundUpdaterRuntime.WriteStatus("relaunching", "Update applied. Relaunching app.", _request.TargetVersion, true);
        BackgroundUpdaterRuntime.TryDeleteFile(_request.InstallerPath);
        ScheduleCleanup();

        StatusChip.Text = "Completed";
        StatusChip.Foreground = new SolidColorBrush(Color.Parse("#6FD7A6"));
        await Task.Delay(800);
        Close();
    }

    private void HandleFailed(string message)
    {
        SetStep("Failed", message, 100);
        BackgroundUpdaterRuntime.WriteStatus("failed", message, _request.TargetVersion, false);

        StatusChip.Text = "Failed";
        StatusChip.Foreground = new SolidColorBrush(Color.Parse("#F08F8F"));

        RetryButton.IsVisible = true;
        CancelButton.Content = "Close";
        _isRetryMode = true;
    }

    private void HandleCancelled()
    {
        SetStep("Cancelled", "Update was cancelled.", 0);
        BackgroundUpdaterRuntime.WriteStatus("cancelled", "Update cancelled by user.", _request.TargetVersion, false);

        StatusChip.Text = "Cancelled";
        StatusChip.Foreground = new SolidColorBrush(Color.Parse("#E2BE67"));

        RetryButton.IsVisible = true;
        CancelButton.Content = "Close";
        _isRetryMode = true;
    }

    private async void RetryButton_Click(object? sender, RoutedEventArgs e)
    {
        if (_isRunActive)
            return;

        _runCts.Dispose();
        _runCts = new CancellationTokenSource();
        _isRetryMode = false;

        await RunUpdateFlowAsync(waitForParentExit: false);
    }

    private void CancelButton_Click(object? sender, RoutedEventArgs e)
    {
        if (_isRetryMode)
        {
            if (_hasValidRequest)
                ScheduleCleanup();
            Close();
            return;
        }

        if (_runCts.IsCancellationRequested)
            return;

        _runCts.Cancel();
        TryTerminateInstallerProcess();
    }

    private void OnClosing(object? sender, WindowClosingEventArgs e)
    {
        if (_isRunActive)
        {
            e.Cancel = true;
            _runCts.Cancel();
            TryTerminateInstallerProcess();
            return;
        }

        if (_hasValidRequest && !_scheduledCleanup)
            ScheduleCleanup();
    }

    private void TryTerminateInstallerProcess()
    {
        if (_installerProcess is null)
            return;

        try
        {
            if (!_installerProcess.HasExited)
                _installerProcess.Kill(true);
        }
        catch
        {
            // Best-effort cancellation.
        }
    }

    private void SetStep(string step, string details, int progress)
    {
        StepText.Text = $"Step: {step}";
        DetailsText.Text = details;
        Progress.Value = Math.Clamp(progress, 0, 100);
    }

    private void ScheduleCleanup()
    {
        if (!_hasValidRequest)
            return;

        if (_scheduledCleanup)
            return;

        _scheduledCleanup = true;
        BackgroundUpdaterRuntime.ScheduleSelfDelete(_request.CleanupRoot);
    }
}
