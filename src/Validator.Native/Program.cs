using System;
using System.IO;
using System.Text;
using System.Windows.Forms;

namespace ComputerUseValidator
{
    internal static class Program
    {
        [STAThread]
        private static void Main()
        {
            NativeDesktop.EnableDpiAwareness();
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new MainForm());
        }

        internal static string FindApiKey()
        {
            string environmentValue = Environment.GetEnvironmentVariable("OPENAI_API_KEY");
            if (!string.IsNullOrWhiteSpace(environmentValue))
            {
                return environmentValue.Trim();
            }

            string[] starts = new string[]
            {
                AppDomain.CurrentDomain.BaseDirectory,
                Environment.CurrentDirectory
            };

            foreach (string start in starts)
            {
                DirectoryInfo current = new DirectoryInfo(start);
                for (int depth = 0; current != null && depth < 6; depth++, current = current.Parent)
                {
                    string path = Path.Combine(current.FullName, ".env");
                    if (!File.Exists(path))
                    {
                        continue;
                    }

                    foreach (string line in File.ReadAllLines(path, Encoding.UTF8))
                    {
                        string trimmed = line.Trim();
                        if (trimmed.StartsWith("OPENAI_API_KEY=", StringComparison.OrdinalIgnoreCase))
                        {
                            string value = trimmed.Substring(trimmed.IndexOf('=') + 1).Trim().Trim('"', '\'');
                            if (!string.IsNullOrWhiteSpace(value))
                            {
                                return value;
                            }
                        }
                    }
                }
            }

            return string.Empty;
        }
    }
}
