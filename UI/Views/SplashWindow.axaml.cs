using System;
using System.IO;
using Avalonia.Controls;
using Avalonia.Media.Imaging;

namespace StellarisModManager.UI.Views;

public partial class SplashWindow : Window
{
    public SplashWindow()
    {
        InitializeComponent();
        TryLoadSplashImage();
    }

    private void TryLoadSplashImage()
    {
        var candidates = new[]
        {
            Path.Combine(AppContext.BaseDirectory, "UI", "Assets", "splash-art.png"),
            @"C:\Users\ricar\Downloads\splash art.png"
        };

        foreach (var path in candidates)
        {
            if (!File.Exists(path))
                continue;

            try
            {
                SplashImage.Source = new Bitmap(path);
                return;
            }
            catch
            {
                // Try next candidate.
            }
        }
    }
}
