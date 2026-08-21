using System;
using System.Collections.Generic;
using System.IO;
using System.Text.RegularExpressions;

namespace ComputerUseValidator
{
    internal static class MarkdownAssets
    {
        private static readonly Regex ImagePathPattern = new Regex(
            @"(?<path>(?:(?:[A-Za-z]:|\.{1,2})[\\/])?[^`\s<>()]+?\.(?:png|jpe?g|webp))",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);

        internal static List<string> FindReferenceImages(string markdownPath, string markdown, int maximum)
        {
            List<string> all = new List<string>();
            HashSet<string> seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            string baseDirectory = Path.GetDirectoryName(Path.GetFullPath(markdownPath));

            foreach (Match match in ImagePathPattern.Matches(markdown ?? string.Empty))
            {
                string raw = match.Groups["path"].Value.Trim().Trim('<', '>');
                if (raw.StartsWith("http://", StringComparison.OrdinalIgnoreCase) ||
                    raw.StartsWith("https://", StringComparison.OrdinalIgnoreCase) ||
                    raw.StartsWith("data:", StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                string decoded = Uri.UnescapeDataString(raw).Replace('/', Path.DirectorySeparatorChar);
                string resolved = Path.IsPathRooted(decoded)
                    ? Path.GetFullPath(decoded)
                    : Path.GetFullPath(Path.Combine(baseDirectory, decoded));

                FileInfo file = new FileInfo(resolved);
                if (file.Exists && file.Length <= 10L * 1024L * 1024L && seen.Add(file.FullName))
                {
                    all.Add(file.FullName);
                }
            }

            if (all.Count <= maximum) return all;

            List<string> sampled = new List<string>();
            HashSet<string> sampledSet = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            for (int index = 0; index < maximum; index++)
            {
                int sourceIndex = (int)Math.Round(index * (all.Count - 1.0) / (maximum - 1.0));
                if (sampledSet.Add(all[sourceIndex])) sampled.Add(all[sourceIndex]);
            }
            return sampled;
        }
    }
}
