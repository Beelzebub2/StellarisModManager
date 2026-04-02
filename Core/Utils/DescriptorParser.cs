using System;
using System.Collections.Generic;
using System.Text;
using StellarisModManager.Core.Services;

namespace StellarisModManager.Core.Utils;

/// <summary>
/// Parses and serializes Stellaris Clausewitz-engine .mod descriptor files.
/// </summary>
public static class DescriptorParser
{
    /// <summary>
    /// Parse the content of a descriptor.mod file into a <see cref="ModDescriptor"/>.
    /// </summary>
    public static ModDescriptor Parse(string content)
    {
        var descriptor = new ModDescriptor { Name = string.Empty, Path = string.Empty };
        var lines = content.Split('\n');

        int i = 0;
        while (i < lines.Length)
        {
            var line = lines[i].Trim();
            i++;

            if (string.IsNullOrWhiteSpace(line) || line.StartsWith('#'))
                continue;

            // Split on first '='
            var eqIdx = line.IndexOf('=');
            if (eqIdx < 0)
                continue;

            var key = line[..eqIdx].Trim();
            var valuePart = line[(eqIdx + 1)..].Trim();

            // Block value: key = { ... }
            if (valuePart == "{" || valuePart.StartsWith("{"))
            {
                var items = new List<string>();
                // Collect until closing brace
                var blockContent = new StringBuilder();
                if (valuePart.Length > 1)
                    blockContent.Append(valuePart[1..]);

                while (i < lines.Length)
                {
                    var blockLine = lines[i].Trim();
                    i++;
                    if (blockLine == "}")
                        break;
                    blockContent.AppendLine(blockLine);
                }

                // Extract quoted strings from the block
                var rawBlock = blockContent.ToString();
                var pos = 0;
                while (pos < rawBlock.Length)
                {
                    var qStart = rawBlock.IndexOf('"', pos);
                    if (qStart < 0) break;
                    var qEnd = rawBlock.IndexOf('"', qStart + 1);
                    if (qEnd < 0) break;
                    items.Add(rawBlock[(qStart + 1)..qEnd]);
                    pos = qEnd + 1;
                }

                if (key == "tags")
                    descriptor.Tags = items;
            }
            else
            {
                // Simple quoted value: key="value"
                var strVal = UnquoteString(valuePart);

                switch (key)
                {
                    case "name":
                        descriptor.Name = strVal;
                        break;
                    case "path":
                        descriptor.Path = strVal;
                        break;
                    case "version":
                        descriptor.Version = strVal;
                        break;
                    case "supported_version":
                        descriptor.SupportedVersion = strVal;
                        break;
                    case "remote_file_id":
                        descriptor.RemoteFileId = strVal;
                        break;
                    case "picture":
                        descriptor.Picture = strVal;
                        break;
                }
            }
        }

        return descriptor;
    }

    /// <summary>
    /// Serialize a <see cref="ModDescriptor"/> to Clausewitz .mod file format.
    /// </summary>
    public static string Serialize(ModDescriptor descriptor)
    {
        var sb = new StringBuilder();

        WriteKv(sb, "name", descriptor.Name);
        WriteKv(sb, "path", descriptor.Path);

        if (descriptor.Version is not null)
            WriteKv(sb, "version", descriptor.Version);

        if (descriptor.SupportedVersion is not null)
            WriteKv(sb, "supported_version", descriptor.SupportedVersion);

        if (descriptor.Picture is not null)
            WriteKv(sb, "picture", descriptor.Picture);

        if (descriptor.RemoteFileId is not null)
            WriteKv(sb, "remote_file_id", descriptor.RemoteFileId);

        if (descriptor.Tags is { Count: > 0 })
        {
            sb.AppendLine("tags={");
            foreach (var tag in descriptor.Tags)
                sb.AppendLine($"\t\"{tag}\"");
            sb.AppendLine("}");
        }

        return sb.ToString();
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    private static void WriteKv(StringBuilder sb, string key, string value)
    {
        sb.AppendLine($"{key}=\"{EscapeString(value)}\"");
    }

    private static string UnquoteString(string value)
    {
        if (value.StartsWith('"') && value.EndsWith('"') && value.Length >= 2)
            return value[1..^1];
        return value;
    }

    private static string EscapeString(string value)
    {
        return value.Replace("\\", "\\\\").Replace("\"", "\\\"");
    }
}
