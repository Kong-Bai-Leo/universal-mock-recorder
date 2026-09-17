using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

namespace UniversalMockRecorder
{
    // Capture-only front end. Analysis and guarded replay use the separate CLI.
    internal sealed class OrcadRecorderForm : Form
    {
        readonly Button start = new Button { Text = "开始录制", Left = 20, Top = 90, Width = 120 };
        readonly Button stop = new Button { Text = "停止并保存", Left = 150, Top = 90, Width = 120, Enabled = false };
        readonly Button pause = new Button { Text = "暂停录制", Left = 280, Top = 90, Width = 120, Enabled = false };
        readonly Button openFolder = new Button { Text = "打开录制目录", Left = 410, Top = 90, Width = 150, Enabled = false };
        readonly CheckBox uia = new CheckBox { Text = "记录 UI Automation（可关闭）", Left = 20, Top = 135, Width = 520, Checked = false };
        readonly Label status = new Label { Text = "就绪。Ctrl+Shift+F12 暂停/恢复。", Left = 20, Top = 175, Width = 545, Height = 90 };
        RecorderEngine engine;
        string recording;

        public OrcadRecorderForm()
        {
            Text = RecorderProfile.WindowTitle;
            Width = 600;
            Height = 320;
            StartPosition = FormStartPosition.CenterScreen;
            Controls.Add(new Label {
                Text = "仅在 OrCAD X Capture 所在的 Windows 会话中录制键鼠和全桌面截图。\n请关闭敏感窗口；当前不会分析、上传或生成回放脚本。",
                Left = 20, Top = 15, Width = 550, Height = 65
            });
            Controls.AddRange(new Control[] { start, stop, pause, openFolder, uia, status });
            start.Click += delegate {
                try {
                    if (engine != null) engine.Dispose();
                    recording = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "recordings",
                        DateTime.Now.ToString("yyyyMMdd-HHmmss") + "-" + Guid.NewGuid().ToString("N").Substring(0, 6));
                    engine = new RecorderEngine(recording, uia.Checked);
                    engine.Start();
                    RefreshControls();
                    WindowState = FormWindowState.Minimized;
                } catch (Exception error) { status.Text = "启动录制失败：" + error.Message; RefreshControls(); }
            };
            stop.Click += delegate {
                try { if (engine != null) engine.Stop(); status.Text = "录制已保存在：\n" + recording + "\n不会自动分析或上传。"; }
                catch (Exception error) { status.Text = "停止录制时出错：" + error.Message; }
                finally { RefreshControls(); }
            };
            pause.Click += delegate {
                try { if (engine != null) engine.TogglePause(); RefreshControls(); }
                catch (Exception error) { status.Text = error.Message; }
            };
            openFolder.Click += delegate {
                try {
                    if (!string.IsNullOrEmpty(recording) && Directory.Exists(recording))
                        Process.Start(new ProcessStartInfo("explorer.exe", "\"" + recording.Replace("\"", "") + "\"") { UseShellExecute = true });
                } catch (Exception error) { status.Text = "无法打开录制目录：" + error.Message; }
            };
            FormClosing += delegate { if (engine != null) engine.Dispose(); };
            var timer = new Timer { Interval = 500 };
            timer.Tick += delegate {
                if (engine != null && engine.IsRecording)
                    status.Text = (engine.IsPaused ? "已暂停" : "正在录制") + "，事件 " + engine.EventCount + "\n" + recording;
                RefreshControls();
            };
            timer.Start();
        }

        void RefreshControls()
        {
            bool active = engine != null && engine.IsRecording;
            start.Enabled = !active;
            stop.Enabled = active;
            pause.Enabled = active;
            pause.Text = active && engine.IsPaused ? "恢复录制" : "暂停录制";
            uia.Enabled = !active;
            openFolder.Enabled = !active && !string.IsNullOrEmpty(recording) && Directory.Exists(recording);
        }
    }
}
