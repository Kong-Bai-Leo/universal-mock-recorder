using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace UniversalMockRecorder
{
    // Independent application entry; the input/screenshot engine remains shared.
    internal sealed class JmpRecorderForm : Form
    {
        readonly Button start = new Button { Text = "开始录制", Left = 20, Top = 85, Width = 120 };
        readonly Button stop = new Button { Text = "停止并保存", Left = 150, Top = 85, Width = 120, Enabled = false };
        readonly Button pause = new Button { Text = "暂停/恢复", Left = 280, Top = 85, Width = 120, Enabled = false };
        readonly Button retry = new Button { Text = "确认重试失败请求", Left = 415, Top = 85, Width = 150 };
        readonly Button prepare = new Button { Text = "准备分析（不上传）", Left = 20, Top = 125, Width = 185 };
        readonly Button analyze = new Button { Text = "正式分析/继续", Left = 220, Top = 125, Width = 180 };
        readonly Button folder = new Button { Text = "选择已有录制", Left = 415, Top = 125, Width = 150 };
        readonly CheckBox uia = new CheckBox { Text = "记录 UI Automation（可关闭）", Left = 20, Top = 165, Width = 520, Checked = true };
        readonly CheckBox english = new CheckBox { Text = "我已在目标 JMP 界面确认语言为 English (en-US)", Left = 20, Top = 190, Width = 540 };
        readonly Button openScript = new Button { Text = "打开脚本位置", Left = 20, Top = 225, Width = 185, Enabled = false };
        readonly Label status = new Label { Text = "就绪。Ctrl+Shift+F12 暂停/恢复。", Left = 20, Top = 265, Width = 560, Height = 110 };
        RecorderEngine engine;
        string recording;
        string replayScript;
        bool busy;
        public JmpRecorderForm()
        {
            Text = RecorderProfile.WindowTitle; Width = 620; Height = 425;
            StartPosition = FormStartPosition.CenterScreen;
            Controls.Add(new Label { Text = "最终输出一个 .jsl 文件，直接在 JMP 中运行，无需另交给 AI。\n必须在 JMP 所在 VM 内录制全桌面截图，请关闭敏感窗口。", Left = 20, Top = 15, Width = 570, Height = 60 });
            Controls.AddRange(new Control[] { start, stop, pause, retry, prepare, analyze, folder, uia, english, openScript, status });
            start.Click += delegate {
                try {
                    if (!english.Checked) throw new InvalidOperationException("请先在 JMP 中确认界面语言，并勾选英文确认项。不会依据 Windows 语言推测。");
                    replayScript = null;
                    recording = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "recordings", DateTime.Now.ToString("yyyyMMdd-HHmmss") + "-" + Guid.NewGuid().ToString("N").Substring(0,6));
                    if (engine != null) engine.Dispose(); engine = new RecorderEngine(recording, uia.Checked, "en-US"); engine.Start(); RefreshControls(); WindowState = FormWindowState.Minimized;
                } catch (Exception e) { status.Text = e.Message; }
            };
            stop.Click += delegate { if (engine != null) engine.Stop(); RefreshControls(); status.Text = "录制保存在：" + recording; };
            pause.Click += delegate { if (engine != null) engine.TogglePause(); RefreshControls(); };
            folder.Click += delegate { using (var dialog = new FolderBrowserDialog()) { if (dialog.ShowDialog(this) == DialogResult.OK) { recording = dialog.SelectedPath; replayScript = null; } } RefreshControls(); status.Text = recording; };
            openScript.Click += delegate {
                try { if (File.Exists(replayScript)) Process.Start(new ProcessStartInfo("explorer.exe", "/select," + Quote(replayScript)) { UseShellExecute = true }); }
                catch (Exception e) { status.Text = e.Message; }
            };
            prepare.Click += async delegate { await Analyze(true); };
            analyze.Click += async delegate { await Analyze(false); };
            retry.Click += async delegate { await Analyze(false, true); };
            FormClosing += delegate(object sender, FormClosingEventArgs e) { if (busy) { e.Cancel = true; status.Text = "分析正在运行；请等其结束，结果和检查点会保留。"; } else if (engine != null) engine.Stop(); };
            var timer = new Timer { Interval = 500 };
            timer.Tick += delegate { if (engine != null && engine.IsRecording) { status.Text = (engine.IsPaused ? "已暂停" : "正在录制") + "，事件 " + engine.EventCount + "\n" + recording; pause.Text = engine.IsPaused ? "恢复录制" : "暂停录制"; } };
            timer.Start();
        }
        void RefreshControls()
        {
            bool active = engine != null && engine.IsRecording;
            start.Enabled = !busy && !active; stop.Enabled = active && !busy; pause.Enabled = active && !busy;
            prepare.Enabled = analyze.Enabled = retry.Enabled = folder.Enabled = uia.Enabled = english.Enabled = !busy && !active;
            openScript.Enabled = !busy && !active && !string.IsNullOrEmpty(replayScript) && File.Exists(replayScript);
        }
        async Task Analyze(bool prepareOnly, bool retryFailed = false)
        {
            if (busy || string.IsNullOrEmpty(recording)) { status.Text = "请先录制，或选择包含 manifest.json 和 events.jsonl 的目录。"; return; }
            if (!prepareOnly && MessageBox.Show(this, (retryFailed ? "这是对失败或结果未知请求的显式重试，可能重复产生费用；已完成分段仍从检查点继续。\n\n" : "") + "将本次准备报告列出的输入事件和截图发送给 OpenAI。每轮最多 2 次请求、每次最多 12 张图、输出最多 6000 tokens；不会自动重试。继续吗？", "确认付费分析", MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;
            busy = true; replayScript = null; RefreshControls(); status.Text = prepareOnly ? "正在本地准备，不调用 API……" : "正在分析；完成后生成可直接运行的 JSL，达到预算后保存检查点。";
            try {
                var root = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", ".."));
                var info = new ProcessStartInfo("powershell.exe") { Arguments = "-NoProfile -ExecutionPolicy Bypass -File " + Quote(Path.Combine(root,"scripts","analyze-jmp-recording.ps1")) + " -Recording " + Quote(recording) + (prepareOnly ? " -PrepareOnly" : " -Analyze") + (retryFailed ? " -RetryFailed" : ""), WorkingDirectory = root, UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true, StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8 };
                using (var process = Process.Start(info)) {
                    var stdout = process.StandardOutput.ReadToEndAsync(); var stderr = process.StandardError.ReadToEndAsync();
                    await Task.Run(() => process.WaitForExit());
                    var output = await stdout; var error = await stderr;
                    if (process.ExitCode != 0) status.Text = "未完成（录制已保留）：" + error;
                    else ShowAnalysisResult(output);
                }
            } catch (Exception e) { status.Text = e.Message; }
            finally { busy = false; RefreshControls(); }
        }
        void ShowAnalysisResult(string output)
        {
            AnalysisResult result;
            using (var input = new MemoryStream(Encoding.UTF8.GetBytes(output.Trim().TrimStart('\uFEFF'))))
                result = (AnalysisResult)new DataContractJsonSerializer(typeof(AnalysisResult)).ReadObject(input);
            if (result.Status == "replay_script_generated_not_executed" || result.Status == "saved_replay_script_generated_not_executed") {
                if (string.IsNullOrEmpty(result.PrimaryOutput) || !string.Equals(Path.GetExtension(result.PrimaryOutput), ".jsl", StringComparison.OrdinalIgnoreCase) || !File.Exists(result.PrimaryOutput))
                    throw new IOException("分析完成，但未找到可运行的 JSL 文件；请检查分析状态文件。");
                replayScript = result.PrimaryOutput;
                status.Text = "已生成 jmp-replay.jsl（尚未实机执行）。\n在 JMP 脚本编辑器中打开，取消文本选择后点 Edit > Run Script。\n点击“打开脚本位置”；仅复制该文件即可，不需要 JSON 或 API 密钥。";
            } else if (result.Status == "prepared_no_upload") {
                status.Text = "准备完成，尚未上传。正式分析前请查看报告：\n" + result.Report;
            } else if (result.Status == "budget_paused") {
                status.Text = "本轮预算已到，已完成 " + result.Completed + "/" + result.Total + " 段。检查点已保存；尚未生成完整脚本。\n可点击“正式分析/继续”，再次确认费用后继续。";
            } else status.Text = output;
        }
        [DataContract]
        sealed class AnalysisResult
        {
            [DataMember(Name = "status")] public string Status { get; set; }
            [DataMember(Name = "primaryOutput")] public string PrimaryOutput { get; set; }
            [DataMember(Name = "report")] public string Report { get; set; }
            [DataMember(Name = "completed")] public int Completed { get; set; }
            [DataMember(Name = "total")] public int Total { get; set; }
        }
        static string Quote(string value) { return "\"" + value.Replace("\"", "") + "\""; }
    }
}
