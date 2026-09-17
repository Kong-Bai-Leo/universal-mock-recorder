using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using System.Text;
using System.Threading;
using System.Windows.Automation;
using System.Windows.Forms;

namespace UniversalMockRecorder
{
    internal static class RecorderProfile
    {
#if ORCAD
        public const string ApplicationId = "orcad-x-capture";
        public const string ApplicationName = "OrCAD X Capture";
        public const string ApplicationVersion = "24.1 P001";
        public const string Language = "system-default";
        public const string WindowTitle = "OrCAD X Capture 操作录制器";
        public const string Header = "在 OrCAD X Capture 所在的 Windows 会话中录制";
        public const string StopButtonText = "停止并保存";
        public const string TargetProcess = "Capture";
        public const string UiMapRoot = "";
        public const string ReplayFormat = "none";
        public const string GenerateOptionText = "仅本地保存录制；分析与回放尚未实现";
        public const string AnalysisScriptFile = "";
        public const string StructuredProgramFile = "";
        public const string ReplayFile = "";
        public const string ReplayDescription = "尚未实现回放";
        public static readonly bool SupportsAutoCadActionRecorder = false;
        public static readonly bool SupportsAnalysis = false;
        public static readonly bool EnableCadCommandHeuristics = false;
        public static readonly bool CaptureThreeDsMaxTransformRegions = false;
        public static readonly bool FilterToTargetProcess = true;
        public static readonly bool RequiresMockScript = false;
        public static readonly bool RequiresReplayFile = false;
#elif VIVADO
        public const string ApplicationId = "vivado";
        public const string ApplicationName = "AMD Vivado";
        public const string ApplicationVersion = "2024.2";
        public const string Language = "en-US";
        public const string WindowTitle = "Vivado 操作录制器";
        public const string Header = "在 Vivado 所在的 Windows 会话中录制";
        public const string StopButtonText = "停止并保存";
        public const string TargetProcess = "vivado";
        public const string UiMapRoot = "ui-maps/vivado/2024.2/en-US";
        public const string ReplayFormat = "vivado-tcl";
        public const string GenerateOptionText = "仅本地保存；正式分析另行确认上传";
        public const string AnalysisScriptFile = "analyze-vivado-recording.ps1";
        public const string StructuredProgramFile = "_internal\\replay-plan.json";
        public const string ReplayFile = "vivado-replay.tcl";
        public const string ReplayDescription = "可在 Vivado 中直接运行的单文件 Tcl 脚本";
        public static readonly bool SupportsAutoCadActionRecorder = false;
        public static readonly bool SupportsAnalysis = true;
        public static readonly bool EnableCadCommandHeuristics = false;
        public static readonly bool CaptureThreeDsMaxTransformRegions = false;
        public static readonly bool FilterToTargetProcess = true;
        public static readonly bool RequiresMockScript = false;
        public static readonly bool RequiresReplayFile = true;
#elif JMP
        public const string ApplicationId = "jmp";
        public const string ApplicationName = "JMP Trial";
        public const string ApplicationVersion = "19.1.5";
        public const string Language = "en-US";
        public const string WindowTitle = "JMP 操作录制器";
        public const string Header = "在 JMP 所在的 Windows 会话中录制";
        public const string StopButtonText = "停止并保存";
        public const string TargetProcess = "jmp";
        public const string UiMapRoot = "ui-maps/jmp/19.1/en-US";
        public const string ReplayFormat = "jmp-jsl";
        public const string GenerateOptionText = "仅本地保存；正式分析另行确认上传";
        public const string AnalysisScriptFile = "analyze-jmp-recording.ps1";
        public const string StructuredProgramFile = "_internal\\replay-plan.json";
        public const string ReplayFile = "jmp-replay.jsl";
        public const string ReplayDescription = "可在 JMP 中直接运行的单文件 JSL 脚本";
        public static readonly bool SupportsAutoCadActionRecorder = false;
        public static readonly bool SupportsAnalysis = true;
        public static readonly bool EnableCadCommandHeuristics = false;
        public static readonly bool CaptureThreeDsMaxTransformRegions = false;
        public static readonly bool FilterToTargetProcess = true;
        public static readonly bool RequiresMockScript = false;
        public static readonly bool RequiresReplayFile = true;
#elif QUARTUS
        public const string ApplicationId = "quartus";
        public const string ApplicationName = "Quartus Prime";
        public const string ApplicationVersion = "26.1.1 Pro";
        public const string Language = "en-US";
        public const string WindowTitle = "Quartus 操作录制器";
        public const string Header = "记录 Quartus 的工程、设计与设置操作";
        public const string StopButtonText = "停止录制";
        public const string TargetProcess = "quartus";
        public const string UiMapRoot = "ui-maps/quartus/26.1.1-pro/en-US";
        public const string ReplayFormat = "quartus-project";
        public const string GenerateOptionText = "停止后调用 AI 分析（上传事件和选取的截图；默认仅保存在本机）";
        public const string AnalysisScriptFile = "analyze-quartus-recording.ps1";
        public const string StructuredProgramFile = "quartus-workflow.json";
        public const string ReplayFile = "project-bundle\\build.tcl";
        public const string ReplayDescription = "Quartus 工程构建文件（需检查构建报告）";
        public static readonly bool SupportsAutoCadActionRecorder = false;
        public static readonly bool SupportsAnalysis = true;
        public static readonly bool EnableCadCommandHeuristics = false;
        public static readonly bool CaptureThreeDsMaxTransformRegions = false;
        public static readonly bool FilterToTargetProcess = true;
        public static readonly bool RequiresMockScript = false;
        public static readonly bool RequiresReplayFile = false;
#elif PSCAD
        public const string ApplicationId = "pscad";
        public const string ApplicationName = "PSCAD";
        public const string ApplicationVersion = "5.1 Free (2026/05/05.0)";
        public const string Language = "en-US";
        public const string WindowTitle = "PSCAD 操作录制器";
        public const string Header = "记录 PSCAD 的元件、连线、参数与仿真操作";
        public const string StopButtonText = "停止录制";
        public const string TargetProcess = "PscadFree";
        public const string UiMapRoot = "ui-maps/pscad/5.1-free-2026.05.05.0/en-US";
        public const string ReplayFormat = "pscad-project-file";
        public const string GenerateOptionText = "停止后调用 AI 分析（上传事件和选取的截图；默认仅保存在本机）";
        public const string AnalysisScriptFile = "analyze-pscad-recording.ps1";
        public const string StructuredProgramFile = "pscad-workflow.json";
        public const string ReplayFile = "pscad-project.py";
        public const string ReplayDescription = "PSCAD 项目生成器（生成后在 PSCAD 打开）";
        public static readonly bool SupportsAutoCadActionRecorder = false;
        public static readonly bool SupportsAnalysis = true;
        public static readonly bool EnableCadCommandHeuristics = false;
        public static readonly bool CaptureThreeDsMaxTransformRegions = false;
        public static readonly bool FilterToTargetProcess = true;
        public static readonly bool RequiresMockScript = false;
        public static readonly bool RequiresReplayFile = true;
#elif KICAD
        public const string ApplicationId = "kicad";
        public const string ApplicationName = "KiCad";
        public const string ApplicationVersion = "10.0.6";
        public const string Language = "system-default";
        public const string WindowTitle = "KiCad 操作录制器 - Windows 11";
        public const string Header = "记录 KiCad 项目管理器、原理图与 PCB 编辑器的操作";
        public const string StopButtonText = "停止并生成";
        public const string TargetProcess = "kicad";
        public const string UiMapRoot = "ui-maps/kicad/10.0.6/en-US";
        public const string ReplayFormat = "kicad-native-python";
        public const string GenerateOptionText = "停止后调用 AI 生成 KiCad 重建脚本（上传事件/截图，原生重建另加最多 2 次请求）";
        public const string AnalysisScriptFile = "analyze-kicad-recording.ps1";
        public const string StructuredProgramFile = "_internal\\kicad-design.json";
        public const string ReplayFile = "kicad-replay.cmd";
        public const string ReplayDescription = "KiCad 重建脚本（双击生成独立文件与校验报告，支持近似布局）";
        public static readonly bool SupportsAutoCadActionRecorder = false;
        public static readonly bool SupportsAnalysis = true;
        public static readonly bool EnableCadCommandHeuristics = false;
        public static readonly bool CaptureThreeDsMaxTransformRegions = false;
        public static readonly bool FilterToTargetProcess = true;
        public static readonly bool RequiresMockScript = true;
        public static readonly bool RequiresReplayFile = true;
#elif THREEDSMAX
        public const string ApplicationId = "autodesk-3dsmax";
        public const string ApplicationName = "Autodesk 3ds Max";
        public const string ApplicationVersion = "2027";
        public const string Language = "en-US";
        public const string WindowTitle = "3ds Max 操作录制器 - Windows 11";
        public const string Header = "记录 3ds Max 的鼠标、键盘、视口与控件变化";
        public const string StopButtonText = "停止并生成";
        public const string TargetProcess = "3dsmax";
        public const string UiMapRoot = "ui-maps/3dsmax/2027/en-US";
        public const string ReplayFormat = "maxscript";
        public const string GenerateOptionText = "停止后自动调用 AI 生成结构化 3D 操作和 MAXScript（会上传录制事件和选取的关键截图）";
        public const string AnalysisScriptFile = "analyze-3dsmax-recording.ps1";
        public const string StructuredProgramFile = "max-program.json";
        public const string ReplayFile = "3dsmax-replay.ms";
        public const string ReplayDescription = "3ds Max MAXScript";
        public static readonly bool SupportsAutoCadActionRecorder = false;
        public static readonly bool SupportsAnalysis = true;
        public static readonly bool EnableCadCommandHeuristics = false;
        public static readonly bool CaptureThreeDsMaxTransformRegions = true;
        public static readonly bool FilterToTargetProcess = true;
        public static readonly bool RequiresMockScript = false;
        public static readonly bool RequiresReplayFile = true;
#else
        public const string ApplicationId = "autodesk-autocad";
        public const string ApplicationName = "Autodesk AutoCAD";
        public const string ApplicationVersion = "2027";
        public const string Language = "en-US";
        public const string WindowTitle = "通用操作录制器 - Windows 11 原型";
        public const string Header = "记录鼠标、键盘、窗口、通用控件和关键截图";
        public const string StopButtonText = "停止并生成";
        public const string TargetProcess = "acad";
        public const string UiMapRoot = "ui-maps/autocad/2027/en-US";
        public const string ReplayFormat = "autocad-scr";
        public const string GenerateOptionText = "停止后自动调用 AI 生成结构化操作和 Mock 脚本（会上传录制事件和选取的关键截图）";
        public const string AnalysisScriptFile = "analyze-recording.ps1";
        public const string StructuredProgramFile = "cad-program.json";
        public const string ReplayFile = "autocad-replay.scr";
        public const string ReplayDescription = "AutoCAD 验证 SCR（仅包含已确认内容）";
        public static readonly bool SupportsAutoCadActionRecorder = true;
        public static readonly bool SupportsAnalysis = true;
        public static readonly bool EnableCadCommandHeuristics = true;
        public static readonly bool CaptureThreeDsMaxTransformRegions = false;
        public static readonly bool FilterToTargetProcess = false;
        public static readonly bool RequiresMockScript = true;
        public static readonly bool RequiresReplayFile = false;
#endif

        public static bool MatchesTargetProcess(string processName)
        {
#if VIVADO
            return string.Equals(processName, "vivado", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(processName, "vvgl", StringComparison.OrdinalIgnoreCase);
#elif KICAD
            return string.Equals(processName, "kicad", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(processName, "eeschema", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(processName, "pcbnew", StringComparison.OrdinalIgnoreCase);
#else
            return string.Equals(processName, TargetProcess, StringComparison.OrdinalIgnoreCase);
#endif
        }
    }

    internal static class Program
    {
        [STAThread]
        private static void Main()
        {
            try
            {
                SetProcessDpiAwarenessContext(new IntPtr(-4));
            }
            catch
            {
                try { SetProcessDPIAware(); } catch { }
            }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
#if ORCAD
            Application.Run(new OrcadRecorderForm());
#elif JMP
            Application.Run(new JmpRecorderForm());
#elif VIVADO
            Application.Run(new VivadoRecorderForm());
#else
            Application.Run(new RecorderForm());
#endif
        }

        [DllImport("user32.dll")]
        private static extern bool SetProcessDPIAware();

        [DllImport("user32.dll")]
        private static extern bool SetProcessDpiAwarenessContext(IntPtr dpiContext);
    }

    internal sealed class RecorderForm : Form
    {
        private readonly Button _startButton;
        private readonly Button _stopButton;
        private readonly Button _retryButton;
        private readonly CheckBox _generateAfterStopCheckBox;
        private readonly CheckBox _autoCadActionRecorderCheckBox;
        private readonly CheckBox _captureUiAutomationCheckBox;
        private readonly Label _statusLabel;
        private readonly Label _pathLabel;
        private readonly System.Windows.Forms.Timer _timer;
        private RecorderEngine _engine;
        private AutoCadActionRecorderBridge _autoCadActionRecorder;
        private string _currentRecordingDirectory;
        private bool _analysisRunning;
        private long _lastEventCount;
#if PSCAD || QUARTUS
        private int _pscadCheckpointTicks;
#endif

        public RecorderForm()
        {
            Text = RecorderProfile.WindowTitle;
            Width = 620;
            Height = 342;
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;

            var title = new Label
            {
                Text = RecorderProfile.Header,
                Left = 24,
                Top = 22,
                Width = 550,
                Height = 28,
                Font = new Font(Font.FontFamily, 11, FontStyle.Bold)
            };

            _startButton = new Button { Text = "开始录制", Left = 24, Top = 66, Width = 130, Height = 38 };
            _stopButton = new Button { Text = RecorderProfile.StopButtonText, Left = 170, Top = 66, Width = 130, Height = 38, Enabled = false };
            _retryButton = new Button { Text = "重新生成", Left = 316, Top = 66, Width = 130, Height = 38, Enabled = false };
            _generateAfterStopCheckBox = new CheckBox
            {
                Text = RecorderProfile.GenerateOptionText,
                Left = 24,
                Top = 112,
                Width = 560,
                Height = 24,
                Checked = RecorderProfile.SupportsAnalysis && RecorderProfile.ApplicationId != "pscad" && RecorderProfile.ApplicationId != "quartus",
                Visible = RecorderProfile.SupportsAnalysis
            };
            _autoCadActionRecorderCheckBox = new CheckBox
            {
                Text = "同时启用 AutoCAD Action Recorder（ACTMX 会保存并用于 AI 分析，仅适用于 AutoCAD）",
                Left = 24,
                Top = 140,
                Width = 560,
                Height = 24,
                Checked = false,
                Visible = RecorderProfile.SupportsAutoCadActionRecorder
            };
            _captureUiAutomationCheckBox = new CheckBox
            {
                Text = "记录 UI Automation 控件信息（关闭后仅使用鼠标、键盘和截图识别）",
                Left = 24,
                Top = 168,
                Width = 560,
                Height = 24,
                Checked = true
            };
#if PSCAD || QUARTUS
            _captureUiAutomationCheckBox.Checked = false;
            _captureUiAutomationCheckBox.Visible = false;
            Controls.Add(new Label { Text = "通过截图、鼠标位置和键盘事件分析操作过程", Left = 24, Top = 168, Width = 560, Height = 24 });
#endif
            _statusLabel = new Label { Text = "尚未开始", Left = 24, Top = 202, Width = 550, Height = 22 };
            _pathLabel = new Label { Text = "", Left = 24, Top = 230, Width = 550, Height = 42, AutoEllipsis = true };

            Controls.Add(title);
            Controls.Add(_startButton);
            Controls.Add(_stopButton);
            Controls.Add(_retryButton);
            Controls.Add(_generateAfterStopCheckBox);
            Controls.Add(_autoCadActionRecorderCheckBox);
            Controls.Add(_captureUiAutomationCheckBox);
            Controls.Add(_statusLabel);
            Controls.Add(_pathLabel);

            _startButton.Click += StartRecording;
            _stopButton.Click += StopRecording;
            _retryButton.Click += RetryAnalysis;
            FormClosing += OnFormClosing;

            _timer = new System.Windows.Forms.Timer { Interval = 500 };
            _timer.Tick += delegate
            {
                if (_engine != null && _engine.IsRecording)
                {
                    _statusLabel.Text = "正在录制，已保存事件 " + _engine.EventCount + " 条。Ctrl+Shift+F12 可暂停隐私输入。";
#if PSCAD || QUARTUS
                    if (++_pscadCheckpointTicks % 4 == 0) _engine.CaptureStateCheckpoint();
#endif
                }
            };
            _timer.Start();
            if (RecorderProfile.SupportsAnalysis)
                LoadPendingRecording();
            else
            {
                _retryButton.Visible = false;
                _captureUiAutomationCheckBox.Top = 112;
                _statusLabel.Top = 146;
                _pathLabel.Top = 174;
                _statusLabel.Text = "3ds Max 录制器已就绪；录制文件与 AutoCAD 完全分开保存。";
            }
        }

        private void LoadPendingRecording()
        {
            try
            {
                var baseDirectory = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "recordings");
                if (!Directory.Exists(baseDirectory)) return;
                var directories = Directory.GetDirectories(baseDirectory);
                Array.Sort(directories, StringComparer.OrdinalIgnoreCase);
                Array.Reverse(directories);
                foreach (var directory in directories)
                {
                    var eventsPath = Path.Combine(directory, "events.jsonl");
                    var completedPath = Path.Combine(directory, "generated", "semantic-trace.json");
#if KICAD
                    completedPath = Path.Combine(directory, "generated", "_internal", "semantic-trace.json");
#endif
                    var checkpointPath = Path.Combine(directory, "generated", "analysis-checkpoint.json");
                    if (!File.Exists(eventsPath)) continue;
                    long count = 0;
                    using (var reader = new StreamReader(eventsPath))
                    {
                        while (reader.ReadLine() != null) count++;
                    }
                    _currentRecordingDirectory = directory;
                    _lastEventCount = count;
                    _retryButton.Enabled = true;
                    _statusLabel.Text = File.Exists(completedPath) &&
#if KICAD
                        !File.Exists(Path.Combine(directory, "generated", "_internal", "analysis-error.json")) &&
                        File.Exists(Path.Combine(directory, "generated", RecorderProfile.StructuredProgramFile)) &&
                        File.Exists(Path.Combine(directory, "generated", "_internal", "mock-script.ts")) &&
                        File.Exists(Path.Combine(directory, "generated", RecorderProfile.ReplayFile))
#else
                        !File.Exists(checkpointPath)
#endif
                        ? "已加载最近一次录制，可以点击“重新生成”使用最新分析逻辑。"
                        : "检测到上次录制尚未生成脚本，可以点击“重新生成”。";
                    _pathLabel.Text = "录制位置：" + directory;
                    break;
                }
            }
            catch
            {
                // 启动时的历史录制检查失败不应阻止新录制。
            }
        }

        private void StartRecording(object sender, EventArgs e)
        {
            if (_analysisRunning) return;
            var baseDirectory = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "recordings");
            var outputDirectory = Path.Combine(baseDirectory, DateTime.Now.ToString("yyyyMMdd-HHmmss"));
            try
            {
                _currentRecordingDirectory = outputDirectory;
                if (RecorderProfile.SupportsAutoCadActionRecorder && _autoCadActionRecorderCheckBox.Checked)
                {
                    WindowState = FormWindowState.Minimized;
                    Application.DoEvents();
                    _autoCadActionRecorder = new AutoCadActionRecorderBridge(outputDirectory);
                    _autoCadActionRecorder.Start();
                }
                _engine = new RecorderEngine(outputDirectory, _captureUiAutomationCheckBox.Checked);
                _engine.Start();
                _startButton.Enabled = false;
                _stopButton.Enabled = true;
                _retryButton.Enabled = false;
                _autoCadActionRecorderCheckBox.Enabled = false;
                _captureUiAutomationCheckBox.Enabled = false;
                _statusLabel.Text = "正在录制" +
                    (_captureUiAutomationCheckBox.Checked ? "" : "（基础输入＋截图模式）") +
                    (_autoCadActionRecorder == null || string.IsNullOrEmpty(_autoCadActionRecorder.LastError)
                        ? ""
                        : "（Action Recorder 未启动，主录制继续）");
                _pathLabel.Text = "保存位置：" + outputDirectory;
                WindowState = FormWindowState.Minimized;
            }
            catch (Exception error)
            {
                if (_engine != null) _engine.Stop();
                if (_autoCadActionRecorder != null) _autoCadActionRecorder.StopAndCollect();
                _engine = null;
                _autoCadActionRecorder = null;
                _autoCadActionRecorderCheckBox.Enabled = true;
                _captureUiAutomationCheckBox.Enabled = true;
                WindowState = FormWindowState.Normal;
                MessageBox.Show(this, error.Message, "无法开始录制", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private void StopRecording(object sender, EventArgs e)
        {
            _statusLabel.Text = "正在保存剩余事件，请稍候……";
            _stopButton.Enabled = false;
            Refresh();
            if (_engine != null) _engine.Stop();
            if (_autoCadActionRecorder != null)
            {
                _statusLabel.Text = "正在停止 AutoCAD Action Recorder 并收集 ACTMX……";
                Refresh();
                _autoCadActionRecorder.StopAndCollect();
            }
            var actionRecorderWarning = _autoCadActionRecorder == null ? null : _autoCadActionRecorder.LastError;
            _autoCadActionRecorder = null;
            _autoCadActionRecorderCheckBox.Enabled = true;
            _captureUiAutomationCheckBox.Enabled = true;
            WindowState = FormWindowState.Normal;
            Activate();

            var eventCount = _engine == null ? 0 : _engine.EventCount;
            _lastEventCount = eventCount;
            if (RecorderProfile.SupportsAnalysis && _generateAfterStopCheckBox.Checked && !string.IsNullOrEmpty(_currentRecordingDirectory))
            {
                StartAnalysis(_currentRecordingDirectory, eventCount);
            }
            else
            {
                _startButton.Enabled = true;
#if KICAD || PSCAD || QUARTUS || JMP || VIVADO
                _retryButton.Enabled = !string.IsNullOrEmpty(_currentRecordingDirectory);
#endif
                _statusLabel.Text = "录制完成，共保存事件 " + eventCount + " 条。" +
                    (string.IsNullOrEmpty(actionRecorderWarning) ? "" : " Action Recorder 未完整保存，请查看 action-recorder.json。");
                _pathLabel.Text = "录制位置：" + _currentRecordingDirectory;
            }
        }

        private void RetryAnalysis(object sender, EventArgs e)
        {
            if (_analysisRunning || string.IsNullOrEmpty(_currentRecordingDirectory)) return;
            StartAnalysis(_currentRecordingDirectory, _lastEventCount);
        }

        private void StartAnalysis(string recordingDirectory, long eventCount)
        {
            _analysisRunning = true;
            _startButton.Enabled = false;
            _stopButton.Enabled = false;
            _retryButton.Enabled = false;
            _generateAfterStopCheckBox.Enabled = false;
            _autoCadActionRecorderCheckBox.Enabled = false;
            _captureUiAutomationCheckBox.Enabled = false;
            _statusLabel.Text = "录制完成（" + eventCount + " 条事件），正在调用 AI 分析并生成结构化操作……";
            _pathLabel.Text = "录制位置：" + recordingDirectory;
            Refresh();

            ThreadPool.QueueUserWorkItem(delegate
            {
                string errorMessage = null;
                try
                {
                    RunAnalyzer(recordingDirectory);
                }
                catch (Exception error)
                {
                    errorMessage = error.Message;
                }

                try
                {
                    BeginInvoke((MethodInvoker)delegate
                    {
                        _analysisRunning = false;
                        _startButton.Enabled = true;
                        _generateAfterStopCheckBox.Enabled = true;
                        _autoCadActionRecorderCheckBox.Enabled = true;
                        _captureUiAutomationCheckBox.Enabled = true;
                        var generatedDirectory = Path.Combine(recordingDirectory, "generated");
                        if (errorMessage == null)
                        {
                            _statusLabel.Text = "生成完成，可以开始下一次录制。";
                            _retryButton.Enabled = true;
                            var cadProgramPath = Path.Combine(generatedDirectory, RecorderProfile.StructuredProgramFile);
                            var replayPath = Path.Combine(generatedDirectory, RecorderProfile.ReplayFile);
                            var replayMessage = File.Exists(replayPath)
                                ? "\r\n\r\n" + RecorderProfile.ReplayDescription + "：\r\n" + replayPath
                                : "\r\n\r\n本次没有足够的精确信息生成 " + RecorderProfile.ReplayFormat + "。";
#if KICAD
                            _pathLabel.Text = "运行入口：" + replayPath;
#else
                            _pathLabel.Text = "结构化操作：" + cadProgramPath;
#endif
                            MessageBox.Show(
                                this,
#if KICAD
                                "KiCad 重建脚本已生成。双击 kicad-replay.cmd 运行；AI 说明见 ai-explanation.md，结果放在 results 文件夹。" + replayMessage,
#elif PSCAD
                                "AI 已根据截图和鼠标／键盘事件完成分析。请检查 pscad-project-plan.json：ready 时可在 PSCAD 打开其中列出的 .pscx；blocked 时需补足证据或操作支持。模型尚未在软件中验收，仿真尚未运行。\r\n" + cadProgramPath + replayMessage,
#elif QUARTUS
                                "AI 分析结果已保存。请检查构建报告；证据不足或操作未支持时会阻止构建。分析完成不代表工程已在 Quartus 编译或还原验证。\r\n" + cadProgramPath,
#else
                                "AI 分析和 Mock 脚本已生成：\r\n" + cadProgramPath + replayMessage,
#endif
                                "生成完成",
                                MessageBoxButtons.OK,
                                MessageBoxIcon.Information);
                        }
                        else
                        {
                            _statusLabel.Text = "录制已保存，但可运行脚本生成失败。";
                            _retryButton.Enabled = true;
                            _pathLabel.Text = "录制位置：" + recordingDirectory;
                            MessageBox.Show(
                                this,
                                errorMessage,
                                "生成失败（录制文件已保留）",
                                MessageBoxButtons.OK,
                                MessageBoxIcon.Error);
                        }
                    });
                }
                catch
                {
                    // 窗口可能已在分析完成前关闭。
                }
            });
        }

        private static void RunAnalyzer(string recordingDirectory)
        {
            var executableDirectory = new DirectoryInfo(AppDomain.CurrentDomain.BaseDirectory);
            var binDirectory = executableDirectory.Parent;
            var workspaceDirectory = binDirectory == null ? null : binDirectory.Parent;
            if (workspaceDirectory == null)
                throw new InvalidOperationException("无法确定项目目录。");

            var scriptPath = Path.Combine(workspaceDirectory.FullName, "scripts", RecorderProfile.AnalysisScriptFile);
            var configPath = Path.Combine(workspaceDirectory.FullName, "config.json");
            if (!File.Exists(scriptPath))
                throw new FileNotFoundException("找不到分析脚本。", scriptPath);
            if (!File.Exists(configPath))
                throw new FileNotFoundException("找不到 config.json。", configPath);

            var startInfo = new ProcessStartInfo
            {
                FileName = "powershell.exe",
                Arguments = "-NoProfile -ExecutionPolicy Bypass -File " + QuoteArgument(scriptPath) +
                    " -Recording " + QuoteArgument(recordingDirectory) +
                    " -Config " + QuoteArgument(configPath),
                WorkingDirectory = workspaceDirectory.FullName,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8
            };

            using (var process = Process.Start(startInfo))
            {
                if (process == null)
                    throw new InvalidOperationException("无法启动分析器。");
                string standardOutput = null;
                string standardError = null;
                var outputReader = new Thread(new ThreadStart(delegate { standardOutput = process.StandardOutput.ReadToEnd(); }));
                var errorReader = new Thread(new ThreadStart(delegate { standardError = process.StandardError.ReadToEnd(); }));
                outputReader.IsBackground = true;
                errorReader.IsBackground = true;
                outputReader.Start();
                errorReader.Start();
                process.WaitForExit();
                outputReader.Join();
                errorReader.Join();
                if (process.ExitCode != 0)
                {
                    var details = string.IsNullOrWhiteSpace(standardError) ? standardOutput : standardError;
                    throw new InvalidOperationException(
                        "分析器返回错误 " + process.ExitCode + "：\r\n" + TrimForDialog(details));
                }
            }

            var generatedScript = Path.Combine(recordingDirectory, "generated", "mock-script.ts");
#if KICAD
            generatedScript = Path.Combine(recordingDirectory, "generated", "_internal", "mock-script.ts");
#endif
            if (RecorderProfile.RequiresMockScript && !File.Exists(generatedScript))
                throw new InvalidOperationException("分析器已结束，但没有找到生成的 mock-script.ts。");
            var cadProgram = Path.Combine(recordingDirectory, "generated", RecorderProfile.StructuredProgramFile);
            if (!File.Exists(cadProgram))
                throw new InvalidOperationException("分析器已结束，但没有找到生成的 " + RecorderProfile.StructuredProgramFile + "。");
            var replayFile = Path.Combine(recordingDirectory, "generated", RecorderProfile.ReplayFile);
            if (RecorderProfile.RequiresReplayFile && !File.Exists(replayFile))
                throw new InvalidOperationException("分析器已结束，但没有找到生成的 " + RecorderProfile.ReplayFile + "。");
        }

        private static string QuoteArgument(string value)
        {
            return "\"" + value.Replace("\"", "\\\"") + "\"";
        }

        private static string TrimForDialog(string value)
        {
            if (string.IsNullOrWhiteSpace(value)) return "没有返回详细信息。";
            value = value.Trim();
            return value.Length <= 1800 ? value : value.Substring(0, 1800) + "…";
        }

        private void OnFormClosing(object sender, FormClosingEventArgs e)
        {
            if (_engine != null) _engine.Stop();
            if (_autoCadActionRecorder != null) _autoCadActionRecorder.StopAndCollect();
        }
    }

    internal sealed class AutoCadActionRecorderBridge
    {
        private readonly string _recordingDirectory;
        private readonly string _evidenceDirectory;
        private IntPtr _autoCadWindow;
        private DateTime _startedAtUtc;
        private string _macroName;
        private bool _started;

        public AutoCadActionRecorderBridge(string recordingDirectory)
        {
            _recordingDirectory = recordingDirectory;
            _evidenceDirectory = Path.Combine(recordingDirectory, "action-recorder");
        }

        public string LastError { get; private set; }

        public bool Start()
        {
            try
            {
                _autoCadWindow = FindAutoCadWindow();
                if (_autoCadWindow == IntPtr.Zero)
                    throw new InvalidOperationException("已启用 AutoCAD Action Recorder，但没有检测到正在运行的 AutoCAD 主窗口。");

                Directory.CreateDirectory(_evidenceDirectory);
                _startedAtUtc = DateTime.UtcNow;
                _macroName = "UMR" + DateTime.Now.ToString("yyyyMMddHHmmss");
                WriteManifest("starting", null, null, null);
                ActivateAutoCad();
                SendKeys.SendWait("{ESC}{ESC}");
                SendKeys.SendWait("_.ACTRECORD");
                SendKeys.SendWait("{ENTER}");
                Thread.Sleep(500);
                _started = true;
                LastError = null;
                WriteManifest("recording", null, null, null);
                return true;
            }
            catch (Exception error)
            {
                _started = false;
                LastError = error.GetType().Name + ": " + error.Message;
                WriteManifest("failed", LastError, null, null);
                return false;
            }
        }

        public bool StopAndCollect()
        {
            if (!_started) return false;
            try
            {
                ActivateAutoCad();
                // 使用命令行版本可避免默认的保存对话框。停止时取消尚未完成的交互提示，
                // 主 Recorder 已在此之前保存完用户的最终截图与事件。
                SendKeys.SendWait("{ESC}{ESC}");
                SendKeys.SendWait("_.-ACTSTOP");
                SendKeys.SendWait("{ENTER}");
                Thread.Sleep(250);
                SendKeys.SendWait(_macroName);
                SendKeys.SendWait("{ENTER}");
                Thread.Sleep(250);
                SendKeys.SendWait("{ENTER}");
                Thread.Sleep(300);

                var source = WaitForMacroFile(_macroName, _startedAtUtc, TimeSpan.FromSeconds(8));
                if (source == null)
                    throw new FileNotFoundException(
                        "AutoCAD 已收到停止命令，但没有在 Autodesk 用户目录中找到 " + _macroName + ".actmx。" +
                        "如果修改过 ACTRECPATH，请把生成的 ACTMX 手动复制到录制目录的 action-recorder 文件夹。"
                    );

                var destination = Path.Combine(_evidenceDirectory, Path.GetFileName(source));
                File.Copy(source, destination, true);
                if (new FileInfo(destination).Length <= 0)
                    throw new IOException("AutoCAD Action Recorder 文件尚未写完，复制结果为空。");
                WriteManifest(
                    "saved",
                    null,
                    source,
                    Path.Combine("action-recorder", Path.GetFileName(destination)).Replace('\\', '/'));
                LastError = null;
                return true;
            }
            catch (Exception error)
            {
                LastError = error.GetType().Name + ": " + error.Message;
                WriteManifest("failed", LastError, null, null);
                return false;
            }
            finally
            {
                _started = false;
            }
        }

        private void ActivateAutoCad()
        {
            ShowWindow(_autoCadWindow, 9);
            if (!SetForegroundWindow(_autoCadWindow))
                throw new InvalidOperationException("无法激活 AutoCAD 窗口，Action Recorder 命令未发送。");
            Thread.Sleep(300);
        }

        private static IntPtr FindAutoCadWindow()
        {
            var processes = Process.GetProcessesByName("acad");
            foreach (var process in processes)
            {
                try
                {
                    if (process.MainWindowHandle != IntPtr.Zero && !string.IsNullOrWhiteSpace(process.MainWindowTitle))
                        return process.MainWindowHandle;
                }
                catch { }
                finally { process.Dispose(); }
            }
            return IntPtr.Zero;
        }

        private static string WaitForMacroFile(string macroName, DateTime startedAtUtc, TimeSpan timeout)
        {
            var deadline = DateTime.UtcNow + timeout;
            string lastPath = null;
            long lastLength = -1;
            DateTime lastWriteTimeUtc = DateTime.MinValue;
            var stablePolls = 0;
            do
            {
                var found = FindMacroFile(macroName, startedAtUtc);
                if (found != null)
                {
                    try
                    {
                        var info = new FileInfo(found);
                        info.Refresh();
                        if (info.Length > 0 && string.Equals(lastPath, found, StringComparison.OrdinalIgnoreCase) &&
                            info.Length == lastLength && info.LastWriteTimeUtc == lastWriteTimeUtc)
                            stablePolls++;
                        else
                            stablePolls = 0;
                        lastPath = found;
                        lastLength = info.Length;
                        lastWriteTimeUtc = info.LastWriteTimeUtc;
                        if (stablePolls >= 2) return found;
                    }
                    catch
                    {
                        stablePolls = 0;
                    }
                }
                Thread.Sleep(300);
            } while (DateTime.UtcNow < deadline);
            return null;
        }

        private static string FindMacroFile(string macroName, DateTime startedAtUtc)
        {
            var roots = new[]
            {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Autodesk"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Autodesk")
            };
            foreach (var root in roots)
            {
                var found = FindMacroFileBelow(root, macroName, startedAtUtc);
                if (found != null) return found;
            }
            return null;
        }

        private static string FindMacroFileBelow(string root, string macroName, DateTime startedAtUtc)
        {
            if (!Directory.Exists(root)) return null;
            var pending = new Stack<string>();
            pending.Push(root);
            while (pending.Count > 0)
            {
                var directory = pending.Pop();
                try
                {
                    foreach (var file in Directory.GetFiles(directory, macroName + ".actm*"))
                    {
                        var info = new FileInfo(file);
                        if (info.LastWriteTimeUtc >= startedAtUtc.AddSeconds(-2)) return file;
                    }
                    foreach (var child in Directory.GetDirectories(directory)) pending.Push(child);
                }
                catch
                {
                    // Autodesk 配置树中可能存在无权访问的缓存目录，继续搜索其他目录。
                }
            }
            return null;
        }

        private void WriteManifest(string status, string error, string sourcePath, string copiedPath)
        {
            try
            {
                Directory.CreateDirectory(_evidenceDirectory);
                var manifest = new ActionRecorderManifest
                {
                    Format = "AutoCadActionRecorderEvidence",
                    Version = "0.1",
                    Enabled = true,
                    Status = status,
                    MacroName = _macroName,
                    StartedAtUtc = _startedAtUtc == default(DateTime) ? null : _startedAtUtc.ToString("o"),
                    SourcePath = sourcePath,
                    CopiedPath = copiedPath,
                    Error = error
                };
                var serializer = new DataContractJsonSerializer(typeof(ActionRecorderManifest));
                using (var stream = File.Create(Path.Combine(_recordingDirectory, "action-recorder.json")))
                    serializer.WriteObject(stream, manifest);
            }
            catch
            {
                // 辅助清单写入失败不能破坏主录制。
            }
        }

        [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr window);
        [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr window, int command);

        [DataContract]
        private sealed class ActionRecorderManifest
        {
            [DataMember(Name = "format")] public string Format;
            [DataMember(Name = "version")] public string Version;
            [DataMember(Name = "enabled")] public bool Enabled;
            [DataMember(Name = "status")] public string Status;
            [DataMember(Name = "macroName", EmitDefaultValue = false)] public string MacroName;
            [DataMember(Name = "startedAtUtc", EmitDefaultValue = false)] public string StartedAtUtc;
            [DataMember(Name = "sourcePath", EmitDefaultValue = false)] public string SourcePath;
            [DataMember(Name = "copiedPath", EmitDefaultValue = false)] public string CopiedPath;
            [DataMember(Name = "error", EmitDefaultValue = false)] public string Error;
        }
    }

    internal sealed class RecorderEngine : IDisposable
    {
        private const int WhMouseLl = 14;
        private const int WhKeyboardLl = 13;
        private const int WmMouseMove = 0x0200;
        private const int WmLButtonDown = 0x0201;
        private const int WmLButtonUp = 0x0202;
        private const int WmRButtonDown = 0x0204;
        private const int WmRButtonUp = 0x0205;
        private const int WmMButtonDown = 0x0207;
        private const int WmMButtonUp = 0x0208;
        private const int WmMouseWheel = 0x020A;
        private const int WmKeyDown = 0x0100;
        private const int WmSysKeyDown = 0x0104;

        private readonly string _outputDirectory;
        private readonly string _screenshotDirectory;
        private readonly bool _captureUiAutomationTargets;
        private readonly BlockingCollection<RawInputEvent> _queue = new BlockingCollection<RawInputEvent>();
        private readonly LowLevelMouseProc _mouseProc;
        private readonly LowLevelKeyboardProc _keyboardProc;
        private Thread _worker;
        private IntPtr _mouseHook = IntPtr.Zero;
        private IntPtr _keyboardHook = IntPtr.Zero;
        private StreamWriter _writer;
        private long _eventSequence;
        private long _eventCount;
        private long _lastMoveMs;
#if PSCAD || QUARTUS
        private long _latestPscadInputMs;
#endif
        private Point _lastMovePoint;
#if KICAD || PSCAD || QUARTUS || JMP || VIVADO || ORCAD
        private WindowInfo _kiCadPointerDownWindow;
        private UiTarget _kiCadPointerDownTarget;
        private string _kiCadPointerDownButton;
#endif
        private Bitmap _pendingMouseBeforeSnapshot;
        private string _pendingMouseBeforeScreenshot;
        private long _pendingMouseBeforeTimestampMs;
        private Point _pendingMouseDownPoint;
        private string _activeVisualCommand;
        private int _activeVisualCommandRemainingActions;
        private long _activeVisualCommandLastSeenMs;
        private string _commandTextBuffer = "";
        private int _threeDsMaxPrimitiveCaptureStepsRemaining;
        private volatile bool _privacyPaused;
        private volatile bool _recording;

        public RecorderEngine(string outputDirectory, bool captureUiAutomationTargets = true)
        {
            _outputDirectory = outputDirectory;
            _screenshotDirectory = Path.Combine(outputDirectory, "screenshots");
#if PSCAD || QUARTUS
            // Visual/input-only profiles never query application controls, including callers outside the form.
            _captureUiAutomationTargets = false;
#else
            _captureUiAutomationTargets = captureUiAutomationTargets;
#endif
            _mouseProc = MouseHookCallback;
            _keyboardProc = KeyboardHookCallback;
        }

        public bool IsRecording { get { return _recording; } }
        public long EventCount { get { return Interlocked.Read(ref _eventCount); } }

#if JMP || VIVADO || ORCAD
        public bool IsPaused { get { return _privacyPaused; } }
        public void TogglePause()
        {
            _privacyPaused = !_privacyPaused;
            Enqueue(new RawInputEvent { Id = NextId(), EventType = _privacyPaused ? "privacy_pause" : "privacy_resume", TimestampMs = UtcNowMs() });
        }
#endif

        public void Start()
        {
            if (_recording) return;
            Directory.CreateDirectory(_screenshotDirectory);
            _writer = new StreamWriter(Path.Combine(_outputDirectory, "events.jsonl"), false, new UTF8Encoding(false));
            _writer.AutoFlush = true;
            WriteManifest();

            _worker = new Thread(ProcessQueue);
            _worker.Name = "Recorder enrichment worker";
            _worker.IsBackground = true;
            _worker.SetApartmentState(ApartmentState.STA);
            _worker.Start();

            _mouseHook = SetWindowsHookEx(WhMouseLl, _mouseProc, GetModuleHandle(null), 0);
            _keyboardHook = SetWindowsHookEx(WhKeyboardLl, _keyboardProc, GetModuleHandle(null), 0);
            if (_mouseHook == IntPtr.Zero || _keyboardHook == IntPtr.Zero)
            {
                Stop();
                throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(), "无法安装全局输入监听器");
            }
            _recording = true;
        }

        public void Stop()
        {
            if (!_recording && _worker == null) return;
#if PSCAD || QUARTUS
            CaptureStateCheckpoint();
#endif
            _recording = false;
            if (_mouseHook != IntPtr.Zero) UnhookWindowsHookEx(_mouseHook);
            if (_keyboardHook != IntPtr.Zero) UnhookWindowsHookEx(_keyboardHook);
            _mouseHook = IntPtr.Zero;
            _keyboardHook = IntPtr.Zero;
            if (!_queue.IsAddingCompleted) _queue.CompleteAdding();
            if (_worker != null && _worker.IsAlive) _worker.Join();
            if (_pendingMouseBeforeSnapshot != null) _pendingMouseBeforeSnapshot.Dispose();
            _pendingMouseBeforeSnapshot = null;
            _pendingMouseBeforeScreenshot = null;
            _pendingMouseBeforeTimestampMs = 0;
            _pendingMouseDownPoint = Point.Empty;
            if (_writer != null) _writer.Dispose();
            _writer = null;
            _worker = null;
        }

        public void Dispose()
        {
            Stop();
            _queue.Dispose();
        }

        private IntPtr MouseHookCallback(int code, IntPtr message, IntPtr data)
        {
            if (code >= 0 && _recording && !_privacyPaused)
            {
                var input = (MsLlHookStruct)Marshal.PtrToStructure(data, typeof(MsLlHookStruct));
                var eventType = MouseEventType(message.ToInt32());
                if (eventType != null)
                {
                    var now = UtcNowMs();
#if KICAD || PSCAD || QUARTUS || JMP || VIVADO || ORCAD
                    var eventWindow = ReadWindowAtPoint(input.Point.X, input.Point.Y);
                    var eventButton = MouseButton(message.ToInt32());
                    var continuingGesture = _kiCadPointerDownWindow != null &&
                        (eventType == "mouse_move" ||
                            (eventType == "mouse_up" && eventButton == _kiCadPointerDownButton));
                    if (continuingGesture) eventWindow = _kiCadPointerDownWindow;
                    if (eventWindow == null || !RecorderProfile.MatchesTargetProcess(eventWindow.ProcessName))
                        return CallNextHookEx(_mouseHook, code, message, data);
#endif
                    if (eventType == "mouse_move")
                    {
                        if (now - _lastMoveMs < 50 || Distance(_lastMovePoint, input.Point) < 4)
                            return CallNextHookEx(_mouseHook, code, message, data);
                        _lastMoveMs = now;
                        _lastMovePoint = input.Point;
                    }

                    var rawInput = new RawInputEvent
                    {
                        Id = NextId(),
                        EventType = eventType,
                        TimestampMs = now,
                        X = input.Point.X,
                        Y = input.Point.Y,
                        Button = MouseButton(message.ToInt32()),
                        WheelDelta = message.ToInt32() == WmMouseWheel ? (short)((input.MouseData >> 16) & 0xffff) : 0,
                        Modifiers = GetModifiers().ToArray()
                    };
#if KICAD || PSCAD || QUARTUS || JMP || VIVADO || ORCAD
                    rawInput.Window = eventWindow;
                    rawInput.Target = continuingGesture ? _kiCadPointerDownTarget :
                        (_captureUiAutomationTargets && eventType != "mouse_move" ? ReadTargetAt(rawInput.X, rawInput.Y) : null);
                    SetRelativePosition(rawInput);
                    if (eventType == "mouse_down")
                    {
                        _kiCadPointerDownWindow = eventWindow;
                        _kiCadPointerDownTarget = rawInput.Target;
                        _kiCadPointerDownButton = eventButton;
                    }
                    else if (eventType == "mouse_up")
                    {
                        _kiCadPointerDownWindow = null;
                        _kiCadPointerDownTarget = null;
                        _kiCadPointerDownButton = null;
                    }
#endif
                    if (eventType == "mouse_down")
                    {
                        try
                        {
                            rawInput.Snapshot = CaptureScreenBitmap();
                            rawInput.SnapshotTimestampMs = UtcNowMs();
                        }
                        catch { }
                    }
                    Enqueue(rawInput);
                }
            }
            return CallNextHookEx(_mouseHook, code, message, data);
        }

        private IntPtr KeyboardHookCallback(int code, IntPtr message, IntPtr data)
        {
            if (code >= 0 && _recording && (message.ToInt32() == WmKeyDown || message.ToInt32() == WmSysKeyDown))
            {
                var input = (KbdLlHookStruct)Marshal.PtrToStructure(data, typeof(KbdLlHookStruct));
                var modifiers = GetModifiers();

                if (input.VirtualKeyCode == (uint)Keys.F12 && modifiers.Contains("CTRL") && modifiers.Contains("SHIFT"))
                {
#if JMP || VIVADO || ORCAD
                    TogglePause();
#else
                    _privacyPaused = !_privacyPaused;
#endif
                    return CallNextHookEx(_keyboardHook, code, message, data);
                }

                if (!_privacyPaused)
                {
                    if (IsModifierKey(input.VirtualKeyCode))
                        return CallNextHookEx(_keyboardHook, code, message, data);

#if KICAD || PSCAD || QUARTUS || JMP || VIVADO || ORCAD
                    var eventWindow = ReadForegroundWindow();
                    if (eventWindow == null || !RecorderProfile.MatchesTargetProcess(eventWindow.ProcessName))
                        return CallNextHookEx(_keyboardHook, code, message, data);
#endif
                    UiTarget focusedTarget;
                    bool isPassword;
                    ReadKeyboardCaptureContext(out focusedTarget, out isPassword);
                    var rawInput = new RawInputEvent
                    {
                        Id = NextId(),
                        EventType = "key_down",
                        TimestampMs = UtcNowMs(),
                        Key = isPassword ? "REDACTED" : NormalizeKeyName(((Keys)input.VirtualKeyCode).ToString().ToUpperInvariant()),
                        Text = isPassword ? null : TranslateKey(input.VirtualKeyCode, input.ScanCode),
                        Modifiers = modifiers.ToArray(),
                        Target = focusedTarget
                    };
#if KICAD || PSCAD || QUARTUS || JMP || VIVADO || ORCAD
                    rawInput.Window = eventWindow;
                    var pointer = Cursor.Position;
                    rawInput.X = pointer.X;
                    rawInput.Y = pointer.Y;
                    SetRelativePosition(rawInput);
#endif
                    if (ShouldCaptureKeyTransition(rawInput))
                    {
                        try
                        {
                            rawInput.Snapshot = CaptureScreenBitmap();
                            rawInput.SnapshotTimestampMs = UtcNowMs();
                        }
                        catch { }
                    }
                    Enqueue(rawInput);
                }
            }
            return CallNextHookEx(_keyboardHook, code, message, data);
        }

        private void Enqueue(RawInputEvent input)
        {
#if PSCAD || QUARTUS
            var desktop = SystemInformation.VirtualScreen;
            input.ScreenshotDesktopBounds = new[] { desktop.X, desktop.Y, desktop.Width, desktop.Height };
            if (input.EventType != "mouse_move" && input.EventType != "state_observation")
                Interlocked.Exchange(ref _latestPscadInputMs, input.TimestampMs);
#endif
            try
            {
                if (!_queue.IsAddingCompleted) _queue.Add(input);
                else if (input.Snapshot != null) input.Snapshot.Dispose();
            }
            catch (InvalidOperationException)
            {
                if (input.Snapshot != null) input.Snapshot.Dispose();
            }
        }

        private void ProcessQueue()
        {
            foreach (var input in _queue.GetConsumingEnumerable())
            {
                try
                {
#if JMP || VIVADO || ORCAD
                    if (input.EventType == "privacy_pause" || input.EventType == "privacy_resume")
                    {
                        WriteEvent(input);
                        continue;
                    }
#endif
#if !KICAD && !PSCAD && !QUARTUS && !JMP && !VIVADO && !ORCAD
                    input.Window = input.EventType.StartsWith("mouse_")
                        ? ReadWindowAtPoint(input.X, input.Y)
                        : ReadForegroundWindow();
#endif
                    if (input.Window != null && input.Window.ProcessId == Process.GetCurrentProcess().Id) continue;
                    if (RecorderProfile.FilterToTargetProcess &&
                        (input.Window == null || !RecorderProfile.MatchesTargetProcess(input.Window.ProcessName)))
                        continue;

                    if (input.EventType.StartsWith("mouse_"))
                    {
#if !KICAD && !PSCAD && !QUARTUS && !JMP && !VIVADO && !ORCAD
                        input.Target = _captureUiAutomationTargets ? ReadTargetAt(input.X, input.Y) : null;
#endif
                        if (input.Window != null && input.Window.Width > 0 && input.Window.Height > 0)
                        {
                            input.RelativeX = Math.Round((double)(input.X - input.Window.X) / input.Window.Width, 6);
                            input.RelativeY = Math.Round((double)(input.Y - input.Window.Y) / input.Window.Height, 6);
                        }
                    }
                    UpdateThreeDsMaxPrimitiveCaptureStateBefore(input);
                    UpdateVisualCommandContext(input);
                    if (input.EventType == "key_down" && input.Snapshot != null)
                    {
                        input.ScreenshotBefore = SaveScreenshot(input.Id + "-before", input.Snapshot);
                        input.ScreenshotBeforeTimestampMs = input.SnapshotTimestampMs;
                        Thread.Sleep(160);
#if KICAD || PSCAD || QUARTUS || JMP || VIVADO || ORCAD
                        if (CanCaptureKiCadAfter(input))
#endif
                        using (var after = CaptureScreenBitmap())
                        {
                            input.ScreenshotAfter = SaveScreenshot(input.Id + "-after", after);
                            input.ScreenshotAfterTimestampMs = UtcNowMs();
                            input.VisualChange = MeasureVisualChange(input.Snapshot, after, input.Window);
                            CaptureThreeDsMaxTransformEvidence(input, input.Snapshot, after);
                        }
                        input.Screenshot = input.ScreenshotAfter;
                        input.ScreenshotTimestampMs = input.ScreenshotAfterTimestampMs;
                    }
                    else if (input.Snapshot != null)
                    {
                        input.Screenshot = SaveScreenshot(input.Id, input.Snapshot);
                        input.ScreenshotTimestampMs = input.SnapshotTimestampMs;
                    }
                    else if (ShouldCaptureScreenshot(input)
#if KICAD || PSCAD || QUARTUS || JMP || VIVADO || ORCAD
                        && CanCaptureKiCadAfter(input)
#endif
                        )
                    {
                        Thread.Sleep(120);
#if KICAD || PSCAD || QUARTUS || JMP || VIVADO || ORCAD
                        if (CanCaptureKiCadAfter(input))
#endif
                        using (var after = CaptureScreenBitmap())
                        {
                            input.Screenshot = SaveScreenshot(input.Id, after);
                            input.ScreenshotTimestampMs = UtcNowMs();
                            if (input.EventType == "mouse_up" && _pendingMouseBeforeSnapshot != null)
                            {
                                input.ScreenshotBefore = _pendingMouseBeforeScreenshot;
                                input.ScreenshotBeforeTimestampMs = _pendingMouseBeforeTimestampMs;
                                if (!string.IsNullOrEmpty(input.VisualCommandContext) &&
                                    IsLikelyCanvasTarget(input.Target, input.Window, input.X, input.Y))
                                {
                                    // 修改命令的第一张 mouse-up 图经常仍显示被选对象、夹点或预览。
                                    // 额外等待画布稳定后再抓一张，形成 before -> selection -> after 三态证据。
                                    input.ScreenshotSelection = input.Screenshot;
                                    input.ScreenshotSelectionTimestampMs = input.ScreenshotTimestampMs;
                                    Thread.Sleep(360);
                                    using (var settled = CaptureScreenBitmap())
                                    {
                                        input.ScreenshotAfter = SaveScreenshot(input.Id + "-after", settled);
                                        input.ScreenshotAfterTimestampMs = UtcNowMs();
                                        input.VisualChange = MeasureVisualChange(_pendingMouseBeforeSnapshot, settled, input.Window);
                                    }
                                }
                                else
                                {
                                    input.ScreenshotAfter = input.Screenshot;
                                    input.ScreenshotAfterTimestampMs = input.ScreenshotTimestampMs;
                                    input.VisualChange = MeasureVisualChange(_pendingMouseBeforeSnapshot, after, input.Window);
                                    CaptureThreeDsMaxTransformEvidence(input, _pendingMouseBeforeSnapshot, after);
                                }
                                _pendingMouseBeforeSnapshot.Dispose();
                                _pendingMouseBeforeSnapshot = null;
                                _pendingMouseBeforeScreenshot = null;
                                _pendingMouseBeforeTimestampMs = 0;
                            }
                        }
                    }

                    if (input.EventType == "mouse_down" && input.Snapshot != null)
                    {
                        if (_pendingMouseBeforeSnapshot != null) _pendingMouseBeforeSnapshot.Dispose();
                        _pendingMouseBeforeSnapshot = (Bitmap)input.Snapshot.Clone();
                        _pendingMouseBeforeScreenshot = input.Screenshot;
                        _pendingMouseBeforeTimestampMs = input.ScreenshotTimestampMs;
                        _pendingMouseDownPoint = new Point(input.X, input.Y);
                        input.ScreenshotBefore = input.Screenshot;
                        input.ScreenshotBeforeTimestampMs = input.ScreenshotTimestampMs;
                    }
                    else if (input.EventType == "mouse_up")
                    {
                        if (string.IsNullOrEmpty(input.ScreenshotAfter))
                        {
                            input.ScreenshotAfter = input.Screenshot;
                            input.ScreenshotAfterTimestampMs = input.ScreenshotTimestampMs;
                        }
                        if (_pendingMouseBeforeSnapshot != null)
                        {
                            input.ScreenshotBefore = _pendingMouseBeforeScreenshot;
                            _pendingMouseBeforeSnapshot.Dispose();
                            _pendingMouseBeforeSnapshot = null;
                            _pendingMouseBeforeScreenshot = null;
                            _pendingMouseBeforeTimestampMs = 0;
                            _pendingMouseDownPoint = Point.Empty;
                        }
                    }

#if JMP || VIVADO || ORCAD
                    CaptureJmpDelayedObservation(input);
#endif
                    WriteEvent(input);
                    UpdateThreeDsMaxPrimitiveCaptureStateAfter(input);
                    Interlocked.Increment(ref _eventCount);
                }
                catch (Exception error)
                {
                    WriteEvent(new RawInputEvent
                    {
                        Id = input.Id,
                        EventType = "capture_error",
                        TimestampMs = input.TimestampMs,
                        Error = error.GetType().Name + ": " + error.Message
                    });
                }
                finally
                {
                    if (input.Snapshot != null) input.Snapshot.Dispose();
                }
            }
        }

#if JMP || VIVADO || ORCAD
        // Applications can create a report after the ordinary 120/160 ms after-frame.
        // Preserve that frame and add a later observation only while the same
        // input remains the most recent one. This is not proof of completion.
        private void CaptureJmpDelayedObservation(RawInputEvent input)
        {
            if (input.EventType != "key_down" && input.EventType != "mouse_up" &&
                input.EventType != "mouse_wheel") return;
            if (_queue.Count != 0 || !_recording || _privacyPaused) return;
            var sequence = Interlocked.Read(ref _eventSequence);
            Thread.Sleep(800);
            if (_queue.Count != 0 || Interlocked.Read(ref _eventSequence) != sequence ||
                !_recording || _privacyPaused || !CanCaptureKiCadAfter(input)) return;
            using (var observed = CaptureScreenBitmap())
            {
                input.ScreenshotSettledAfter = SaveScreenshot(input.Id + "-settled-after", observed);
                input.ScreenshotSettledAfterTimestampMs = UtcNowMs();
            }
        }
#endif

        private void WriteEvent(RawInputEvent input)
        {
            var serializer = new DataContractJsonSerializer(typeof(RawInputEvent));
            using (var memory = new MemoryStream())
            {
                serializer.WriteObject(memory, input);
                _writer.WriteLine(Encoding.UTF8.GetString(memory.ToArray()));
            }
        }

        private void WriteManifest()
        {
            File.WriteAllText(
                Path.Combine(_outputDirectory, "manifest.json"),
                "{\n" +
                "  \"format\": \"UniversalInteractionTrace\",\n" +
                "  \"version\": \"0.3\",\n" +
                "  \"platform\": \"windows\",\n" +
                "  \"applicationProfile\": \"" + RecorderProfile.ApplicationId + "\",\n" +
                "  \"applicationName\": \"" + RecorderProfile.ApplicationName + "\",\n" +
                "  \"applicationVersion\": \"" + RecorderProfile.ApplicationVersion + "\",\n" +
                "  \"language\": \"" + RecorderProfile.Language + "\",\n" +
                "  \"targetProcess\": \"" + RecorderProfile.TargetProcess + "\",\n" +
#if JMP || VIVADO || ORCAD
                "  \"captureDeployment\": \"same-windows-session\",\n" +
                "  \"screenshotScope\": \"virtual-desktop\",\n" +
                "  \"screenshotOriginX\": " + SystemInformation.VirtualScreen.Left + ",\n" +
                "  \"screenshotOriginY\": " + SystemInformation.VirtualScreen.Top + ",\n" +
#elif QUARTUS
                "  \"targetProcesses\": [\"quartus\"],\n" +
                "  \"uiMapLanguage\": \"en-US\",\n" +
                "  \"screenshotScope\": \"virtual-desktop\",\n" +
                "  \"captureLocation\": \"same-windows-session-as-quartus\",\n" +
                "  \"captureMode\": \"visual-input\",\n" +
                "  \"softwareInternalApi\": false,\n" +
                "  \"passwordFieldProbe\": false,\n" +
                "  \"versionQualification\": \"profile-target-not-binary-inspection\",\n" +
#elif PSCAD
                "  \"targetProcesses\": [\"PscadFree\"],\n" +
                "  \"uiMapLanguage\": \"en-US\",\n" +
                "  \"screenshotScope\": \"virtual-desktop\",\n" +
                "  \"captureLocation\": \"same-windows-session-as-pscad\",\n" +
                "  \"captureMode\": \"visual-input\",\n" +
                "  \"softwareInternalApi\": false,\n" +
                "  \"passwordFieldProbe\": false,\n" +
                "  \"versionQualification\": \"profile-target-not-binary-inspection\",\n" +
#elif KICAD
                "  \"targetProcesses\": [\"kicad\", \"eeschema\", \"pcbnew\"],\n" +
                "  \"uiMapLanguage\": \"en-US\",\n" +
                "  \"screenshotScope\": \"virtual-desktop\",\n" +
#endif
                "  \"uiMapRoot\": \"" + RecorderProfile.UiMapRoot + "\",\n" +
                "  \"preferredReplayFormat\": \"" + RecorderProfile.ReplayFormat + "\",\n" +
                "  \"uiAutomationTargets\": " + (_captureUiAutomationTargets ? "true" : "false") + ",\n" +
                "  \"capabilities\": [\"input_events\", \"before_after_screenshots\", \"visual_change_diff\"" +
                (RecorderProfile.EnableCadCommandHeuristics ? ", \"command_context_screenshot_bursts\"" : "") +
                (RecorderProfile.CaptureThreeDsMaxTransformRegions
                    ? ", \"3dsmax_transform_region_evidence\", \"3dsmax_drag_transactions\", \"3dsmax_parameter_region_evidence\""
                    : "") +
                (_captureUiAutomationTargets ? ", \"ui_automation_targets\"" : "") + "],\n" +
                "  \"createdAt\": \"" + DateTimeOffset.UtcNow.ToString("o") + "\"\n" +
                "}\n",
                new UTF8Encoding(false));
        }

        private string CaptureScreenshot(string eventId)
        {
            using (var bitmap = CaptureScreenBitmap())
            {
                return SaveScreenshot(eventId, bitmap);
            }
        }

        private static Bitmap CaptureScreenBitmap()
        {
            var bounds = SystemInformation.VirtualScreen;
            var bitmap = new Bitmap(bounds.Width, bounds.Height, PixelFormat.Format24bppRgb);
            try
            {
                using (var graphics = Graphics.FromImage(bitmap))
                    graphics.CopyFromScreen(bounds.Left, bounds.Top, 0, 0, bounds.Size, CopyPixelOperation.SourceCopy);
                return bitmap;
            }
            catch
            {
                bitmap.Dispose();
                throw;
            }
        }

        private string SaveScreenshot(string eventId, Bitmap bitmap)
        {
            var relativePath = Path.Combine("screenshots", eventId + ".jpg");
#if PSCAD || QUARTUS
            SaveHighQualityJpeg(bitmap, Path.Combine(_outputDirectory, relativePath), 90L);
#else
            bitmap.Save(Path.Combine(_outputDirectory, relativePath), ImageFormat.Jpeg);
#endif
            return relativePath.Replace('\\', '/');
        }

#if PSCAD || QUARTUS
        public void CaptureStateCheckpoint()
        {
            if (!_recording || _privacyPaused || _queue.Count > 0) return;
            var window = ReadForegroundWindow();
            if (window == null || !RecorderProfile.MatchesTargetProcess(window.ProcessName)) return;
            try
            {
                var input = new RawInputEvent { Id = NextId(), EventType = "state_observation",
                    TimestampMs = UtcNowMs(), Window = window };
                input.Snapshot = CaptureScreenBitmap();
                input.SnapshotTimestampMs = UtcNowMs();
                Enqueue(input);
            }
            catch { }
        }
#endif

        private void CaptureThreeDsMaxTransformEvidence(RawInputEvent input, Bitmap before, Bitmap after)
        {
            if (!RecorderProfile.CaptureThreeDsMaxTransformRegions || before == null || after == null ||
                input == null || input.Window == null || !ShouldCaptureThreeDsMaxTransformEvidence(input))
                return;

            var evidence = new List<ScreenshotRegionEvidence>();
            if (IsThreeDsMaxCloneOptionsWindow(input.Window))
            {
                AddTransformRegionPair(evidence, input.Id, "clone_options", before, after, input.Window,
                    0.0, 0.0, 1.0, 1.0);
                if (evidence.Count > 0) input.TransformEvidence = evidence;
                return;
            }

            if (IsThreeDsMaxPolyOperationDialog(input.Window))
            {
                AddTransformRegionPair(evidence, input.Id, "subobject_parameters", before, after, input.Window,
                    0.0, 0.0, 1.0, 1.0);
                if (evidence.Count > 0) input.TransformEvidence = evidence;
                return;
            }

            if (string.Equals(input.Button, "right", StringComparison.OrdinalIgnoreCase))
            {
                if (input.Window.Width <= 900 && input.Window.Height <= 1200)
                    AddTransformRegionPair(evidence, input.Id, "context_menu", before, after, input.Window,
                        0.0, 0.0, 1.0, 1.0);
                else
                    AddPointerCenteredTransformRegionPair(evidence, input, "context_menu", before, after,
                        0.38, 0.50, 0.05);
                if (evidence.Count > 0) input.TransformEvidence = evidence;
                return;
            }

            AddTransformRegionPair(evidence, input.Id, "transform_toolbar", before, after, input.Window,
                0.075, 0.005, 0.14, 0.09);
            AddTransformRegionPair(evidence, input.Id, "scene_explorer", before, after, input.Window,
                0.005, 0.05, 0.22, 0.34);
            AddTransformRegionPair(evidence, input.Id, "selected_object", before, after, input.Window,
                0.84, 0.055, 0.16, 0.36);
            AddTransformRegionPair(evidence, input.Id, "transform_type_in", before, after, input.Window,
                0.55, 0.91, 0.40, 0.085);
            AddTransformRegionPair(evidence, input.Id, "command_panel_context", before, after, input.Window,
                0.90, 0.05, 0.10, 0.30);
            AddTransformRegionPair(evidence, input.Id, "command_panel_parameters", before, after, input.Window,
                0.84, 0.20, 0.16, 0.70);
            if (IsThreeDsMaxViewportTransformDrag(input))
            {
                AddPointerCenteredTransformRegionPair(evidence, input, "viewport_transform_overlay", before, after,
                    0.40, 0.36, 0.65);
            }
            if (IsThreeDsMaxViewportLeftRelease(input))
            {
                // A polygon Bevel is often two-stage: release height, then click
                // to commit outline. Capture that click too, even without UIA.
                AddPointerCenteredTransformRegionPair(evidence, input, "subobject_operation_context", before, after,
                    0.40, 0.40, 0.35);
            }
            if (evidence.Count > 0) input.TransformEvidence = evidence;
        }

        private bool ShouldCaptureThreeDsMaxTransformEvidence(RawInputEvent input)
        {
            if (input.EventType == "key_down")
            {
                var key = (input.Key ?? "").ToUpperInvariant();
                var quickAlign = key == "A" && input.Modifiers != null &&
                    Array.Exists(input.Modifiers,
                        modifier => string.Equals(modifier, "SHIFT", StringComparison.OrdinalIgnoreCase));
                return key == "W" || key == "E" || key == "R" || key == "ENTER" || key == "RETURN" || quickAlign;
            }
            if (input.EventType != "mouse_up")
                return false;
            if (input.Window.Width <= 0 || input.Window.Height <= 0) return false;
            if (IsThreeDsMaxCloneOptionsWindow(input.Window)) return true;
            if (IsThreeDsMaxPolyOperationDialog(input.Window)) return true;
            if (string.Equals(input.Button, "right", StringComparison.OrdinalIgnoreCase)) return true;
            if (!string.Equals(input.Button, "left", StringComparison.OrdinalIgnoreCase)) return false;

            var relativeX = (double)(input.X - input.Window.X) / input.Window.Width;
            var relativeY = (double)(input.Y - input.Window.Y) / input.Window.Height;
            var topTransformToolbar = relativeX >= 0.06 && relativeX <= 0.24 && relativeY <= 0.11;
            var bottomTransformTypeIn = relativeX >= 0.62 && relativeX <= 0.92 && relativeY >= 0.90;
            var commandPanelInteraction = relativeX >= 0.90 && relativeY >= 0.05 && relativeY <= 0.90;
            var viewportDrag = IsThreeDsMaxViewportTransformDrag(input);
            var primitiveCreationStep = _threeDsMaxPrimitiveCaptureStepsRemaining > 0 &&
                IsThreeDsMaxViewportLeftRelease(input);
            return topTransformToolbar || bottomTransformTypeIn || commandPanelInteraction || viewportDrag ||
                primitiveCreationStep || IsThreeDsMaxViewportLeftRelease(input);
        }

        private static bool IsThreeDsMaxPolyOperationDialog(WindowInfo window)
        {
            if (window == null || window.Width > 1000 || window.Height > 1200) return false;
            var title = window.Title ?? "";
            return title.IndexOf("Bevel", StringComparison.OrdinalIgnoreCase) >= 0;
        }

        private void UpdateThreeDsMaxPrimitiveCaptureStateBefore(RawInputEvent input)
        {
            if (!RecorderProfile.CaptureThreeDsMaxTransformRegions || input == null) return;
            if (input.EventType == "mouse_up" &&
                (IsThreeDsMaxPrimitiveCreateTarget(input.Target) ||
                 (!_captureUiAutomationTargets && IsThreeDsMaxPrimitivePanelClick(input))))
                _threeDsMaxPrimitiveCaptureStepsRemaining = 2;
            else if (input.EventType == "key_down" && string.Equals(input.Key, "ESCAPE", StringComparison.OrdinalIgnoreCase))
                _threeDsMaxPrimitiveCaptureStepsRemaining = 0;
        }

        private static bool IsThreeDsMaxPrimitivePanelClick(RawInputEvent input)
        {
            if (input == null || input.Window == null || input.Window.Width <= 0 || input.Window.Height <= 0 ||
                input.EventType != "mouse_up" || !string.Equals(input.Button, "left", StringComparison.OrdinalIgnoreCase))
                return false;
            var relativeX = (double)(input.X - input.Window.X) / input.Window.Width;
            var relativeY = (double)(input.Y - input.Window.Y) / input.Window.Height;
            // Create > Standard Primitives 的对象类型按钮位于命令面板顶部。无 UIA 时仅把
            // 该窄区域视为“可能开始基本体创建”，随后最多捕获两个视口阶段。
            return relativeX >= 0.90 && relativeY >= 0.14 && relativeY <= 0.30;
        }

        private void UpdateThreeDsMaxPrimitiveCaptureStateAfter(RawInputEvent input)
        {
            if (_threeDsMaxPrimitiveCaptureStepsRemaining > 0 && IsThreeDsMaxViewportLeftRelease(input))
                _threeDsMaxPrimitiveCaptureStepsRemaining--;
        }

        private static bool IsThreeDsMaxPrimitiveCreateTarget(UiTarget target)
        {
            if (target == null) return false;
            var name = target.Name ?? "";
            var primitive = name == "Box" || name == "Sphere" || name == "GeoSphere" ||
                name == "Cylinder" || name == "Tube" || name == "Torus" || name == "Teapot" ||
                name == "Plane" || name == "Cone" || name == "Pyramid" || name == "TextPlus";
            if (!primitive) return false;
            if (target.Ancestors == null) return true;
            foreach (var ancestor in target.Ancestors)
            {
                var searchable = (ancestor.Name ?? "") + " " + (ancestor.AutomationId ?? "");
                if (searchable.IndexOf("CreateButtonPanel", StringComparison.OrdinalIgnoreCase) >= 0 ||
                    searchable.IndexOf("Object Type", StringComparison.OrdinalIgnoreCase) >= 0 ||
                    searchable.IndexOf("QtCreatePanelWidget", StringComparison.OrdinalIgnoreCase) >= 0)
                    return true;
            }
            return false;
        }

        private static bool IsThreeDsMaxViewportLeftRelease(RawInputEvent input)
        {
            if (input == null || input.Window == null || input.Window.Width <= 0 || input.Window.Height <= 0 ||
                input.EventType != "mouse_up" || !string.Equals(input.Button, "left", StringComparison.OrdinalIgnoreCase))
                return false;
            var relativeX = (double)(input.X - input.Window.X) / input.Window.Width;
            var relativeY = (double)(input.Y - input.Window.Y) / input.Window.Height;
            return relativeX >= 0.01 && relativeX <= 0.90 && relativeY >= 0.10 && relativeY <= 0.95;
        }

        private void AddPointerCenteredTransformRegionPair(List<ScreenshotRegionEvidence> evidence,
            RawInputEvent input, string kind, Bitmap before, Bitmap after, double width, double height,
            double verticalBias)
        {
            var pointerX = (double)(input.X - input.Window.X) / input.Window.Width;
            var pointerY = (double)(input.Y - input.Window.Y) / input.Window.Height;
            var left = Math.Max(0.0, Math.Min(1.0 - width, pointerX - width / 2.0));
            var top = Math.Max(0.02, Math.Min(0.98 - height, pointerY - height * verticalBias));
            AddTransformRegionPair(evidence, input.Id, kind, before, after, input.Window,
                left, top, width, height);
        }

        private bool IsThreeDsMaxViewportTransformDrag(RawInputEvent input)
        {
            if (input == null || input.Window == null || input.Window.Width <= 0 || input.Window.Height <= 0 ||
                input.EventType != "mouse_up" || !string.Equals(input.Button, "left", StringComparison.OrdinalIgnoreCase))
                return false;
            var relativeX = (double)(input.X - input.Window.X) / input.Window.Width;
            var relativeY = (double)(input.Y - input.Window.Y) / input.Window.Height;
            return Distance(_pendingMouseDownPoint, new Point(input.X, input.Y)) >= 6 &&
                relativeX >= 0.01 && relativeX <= 0.90 && relativeY >= 0.10 && relativeY <= 0.95 &&
                input.VisualChange != null && input.VisualChange.Changed;
        }

        private static bool IsThreeDsMaxCloneOptionsWindow(WindowInfo window)
        {
            return window != null && !string.IsNullOrEmpty(window.Title) &&
                window.Title.IndexOf("Clone Options", StringComparison.OrdinalIgnoreCase) >= 0;
        }

        private void AddTransformRegionPair(List<ScreenshotRegionEvidence> evidence, string eventId, string kind,
            Bitmap before, Bitmap after, WindowInfo window, double relativeX, double relativeY,
            double relativeWidth, double relativeHeight)
        {
            AddTransformRegion(evidence, eventId, kind, "before", before, window,
                relativeX, relativeY, relativeWidth, relativeHeight);
            AddTransformRegion(evidence, eventId, kind, "after", after, window,
                relativeX, relativeY, relativeWidth, relativeHeight);
        }

        private void AddTransformRegion(List<ScreenshotRegionEvidence> evidence, string eventId, string kind,
            string phase, Bitmap bitmap, WindowInfo window, double relativeX, double relativeY,
            double relativeWidth, double relativeHeight)
        {
            var virtualBounds = SystemInformation.VirtualScreen;
            var left = window.X - virtualBounds.Left + (int)Math.Round(window.Width * relativeX);
            var top = window.Y - virtualBounds.Top + (int)Math.Round(window.Height * relativeY);
            var width = Math.Max(1, (int)Math.Round(window.Width * relativeWidth));
            var height = Math.Max(1, (int)Math.Round(window.Height * relativeHeight));
            var bounds = Rectangle.Intersect(new Rectangle(left, top, width, height),
                new Rectangle(0, 0, bitmap.Width, bitmap.Height));
            if (bounds.Width <= 1 || bounds.Height <= 1) return;

            var relativePath = Path.Combine("screenshots", "transform",
                eventId + "-" + kind + "-" + phase + ".jpg");
            var absolutePath = Path.Combine(_outputDirectory, relativePath);
            Directory.CreateDirectory(Path.GetDirectoryName(absolutePath));
            using (var cropped = bitmap.Clone(bounds, PixelFormat.Format24bppRgb))
                SaveHighQualityJpeg(cropped, absolutePath, 95L);
            evidence.Add(new ScreenshotRegionEvidence
            {
                Kind = kind,
                Phase = phase,
                Screenshot = relativePath.Replace('\\', '/'),
                RelativeBounds = new[] { relativeX, relativeY, relativeWidth, relativeHeight },
                PixelBounds = new[] { bounds.X, bounds.Y, bounds.Width, bounds.Height }
            });
        }

        private static void SaveHighQualityJpeg(Bitmap bitmap, string path, long quality)
        {
            var codec = Array.Find(ImageCodecInfo.GetImageEncoders(), item => item.MimeType == "image/jpeg");
            if (codec == null)
            {
                bitmap.Save(path, ImageFormat.Jpeg);
                return;
            }
            using (var parameters = new EncoderParameters(1))
            {
                parameters.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, quality);
                bitmap.Save(path, codec, parameters);
            }
        }

        private static bool ShouldCaptureScreenshot(RawInputEvent input)
        {
            return input.EventType == "mouse_down" || input.EventType == "mouse_up" ||
                   (input.EventType == "key_down" && (input.Key == "ENTER" || input.Key == "ESCAPE"));
        }

        private static bool ShouldCaptureKeyTransition(RawInputEvent input)
        {
            if (input == null || input.EventType != "key_down") return false;
#if KICAD || PSCAD || QUARTUS || JMP || VIVADO || ORCAD
            // Single-letter shortcuts act at the cursor; UIA may not expose the canvas.
            // Capture every non-redacted key so both tool activation and field edits have evidence.
            return input.Key != "REDACTED";
#else
            if (input.Key == "ENTER" || input.Key == "RETURN" || input.Key == "ESCAPE" || input.Key == "DELETE" ||
                input.Key == "BACK" || input.Key == "BACKSPACE") return true;
            if (RecorderProfile.CaptureThreeDsMaxTransformRegions &&
                (input.Key == "W" || input.Key == "E" || input.Key == "R")) return true;
            return input.Modifiers != null && input.Modifiers.Length > 0;
#endif
        }

#if KICAD || PSCAD || QUARTUS || JMP || VIVADO || ORCAD
        private bool CanCaptureKiCadAfter(RawInputEvent input)
        {
            if (_privacyPaused) return false;
            var window = ReadForegroundWindow();
#if PSCAD || QUARTUS
            // A delayed worker image must not be attributed to an earlier edit or dialog.
            if (input.Window == null || window == null ||
#if QUARTUS
                input.Window.Handle != window.Handle ||
#endif
                input.Window.ProcessId != window.ProcessId || input.Window.Title != window.Title ||
                input.Window.X != window.X || input.Window.Y != window.Y ||
                input.Window.Width != window.Width || input.Window.Height != window.Height ||
                Interlocked.Read(ref _latestPscadInputMs) > input.TimestampMs) return false;
#endif
            return window != null && RecorderProfile.MatchesTargetProcess(window.ProcessName);
        }

        private static void SetRelativePosition(RawInputEvent input)
        {
            if (input.Window == null || input.Window.Width <= 0 || input.Window.Height <= 0) return;
            input.RelativeX = Math.Round((double)(input.X - input.Window.X) / input.Window.Width, 6);
            input.RelativeY = Math.Round((double)(input.Y - input.Window.Y) / input.Window.Height, 6);
        }
#endif

        private static bool IsLikelyCanvasTarget(UiTarget target, WindowInfo window, int pointX = 0, int pointY = 0)
        {
            if (target == null)
            {
                if (window == null || window.Width <= 0 || window.Height <= 0) return false;
                var relativeX = (double)(pointX - window.X) / window.Width;
                var relativeY = (double)(pointY - window.Y) / window.Height;
                // 无 UI Automation 时只把窗口中央的大内容区视为画布，排除顶部 Ribbon 和底部状态栏。
                return relativeX >= 0.01 && relativeX <= 0.99 && relativeY >= 0.10 && relativeY <= 0.95;
            }
            var searchable = ((target.Role ?? "") + " " + (target.ClassName ?? "") + " " + (target.Name ?? ""));
            if (searchable.IndexOf("ACADDM_CHILD", StringComparison.OrdinalIgnoreCase) >= 0 ||
                searchable.IndexOf("DXGI_FLIP_MODE_VIEW", StringComparison.OrdinalIgnoreCase) >= 0 ||
                searchable.IndexOf("Qmax", StringComparison.OrdinalIgnoreCase) >= 0 ||
                searchable.IndexOf("3ds Max", StringComparison.OrdinalIgnoreCase) >= 0 ||
                searchable.IndexOf("Viewport", StringComparison.OrdinalIgnoreCase) >= 0)
                return true;
            if (window == null || window.Width <= 0 || window.Height <= 0 || target.Width <= 0 || target.Height <= 0)
                return false;
            var roleIsCanvas = searchable.IndexOf("Pane", StringComparison.OrdinalIgnoreCase) >= 0 ||
                               searchable.IndexOf("Document", StringComparison.OrdinalIgnoreCase) >= 0 ||
                               searchable.IndexOf("Custom", StringComparison.OrdinalIgnoreCase) >= 0;
            var areaRatio = (double)target.Width * target.Height / Math.Max(1.0, (double)window.Width * window.Height);
            return roleIsCanvas && areaRatio >= 0.2;
        }

        private void UpdateVisualCommandContext(RawInputEvent input)
        {
            if (!RecorderProfile.EnableCadCommandHeuristics)
            {
                input.VisualCommandContext = null;
                return;
            }
            var detected = DetectVisualModificationCommand(input);
            if (_activeVisualCommand != null && detected != null &&
                !string.Equals(_activeVisualCommand, detected, StringComparison.OrdinalIgnoreCase) &&
                IsDynamicInputTarget(input.Target))
                detected = null;
            if (input.EventType == "key_down")
            {
                var key = (input.Key ?? "").ToUpperInvariant();
                if (key == "ESCAPE")
                {
                    _commandTextBuffer = "";
                    _activeVisualCommand = null;
                    _activeVisualCommandRemainingActions = 0;
                }
                else if (key == "BACK" || key == "BACKSPACE")
                {
                    if (_commandTextBuffer.Length > 0)
                        _commandTextBuffer = _commandTextBuffer.Substring(0, _commandTextBuffer.Length - 1);
                }
                else if (!string.IsNullOrEmpty(input.Text) && input.Text.Length == 1 &&
                         (input.Modifiers == null || (Array.IndexOf(input.Modifiers, "CTRL") < 0 &&
                          Array.IndexOf(input.Modifiers, "ALT") < 0 && Array.IndexOf(input.Modifiers, "WIN") < 0)))
                {
                    _commandTextBuffer += input.Text.ToUpperInvariant();
                    if (_commandTextBuffer.Length > 40)
                        _commandTextBuffer = _commandTextBuffer.Substring(_commandTextBuffer.Length - 40);
                }

                if (key == "ENTER" || key == "RETURN" || key == "SPACE")
                {
                    var typedCommand = DetectVisualModificationCommandText(_commandTextBuffer);
                    if (typedCommand != null) detected = typedCommand;
                    _commandTextBuffer = "";
                }
            }

            if (detected != null)
            {
                _activeVisualCommand = detected;
                _activeVisualCommandRemainingActions = 30;
                _activeVisualCommandLastSeenMs = input.TimestampMs;
            }
            else if (_activeVisualCommand != null && input.EventType != "mouse_move")
            {
                if (input.EventType == "mouse_down" && IsDifferentRibbonTarget(input.Target))
                {
                    _activeVisualCommand = null;
                    _activeVisualCommandRemainingActions = 0;
                    input.VisualCommandContext = null;
                    return;
                }
                _activeVisualCommandRemainingActions--;
                if (_activeVisualCommandRemainingActions < 0 ||
                    input.TimestampMs - _activeVisualCommandLastSeenMs > 90000)
                {
                    _activeVisualCommand = null;
                    _activeVisualCommandRemainingActions = 0;
                }
                else
                {
                    _activeVisualCommandLastSeenMs = input.TimestampMs;
                }
            }

            input.VisualCommandContext = _activeVisualCommand;
        }

        private static bool IsDifferentRibbonTarget(UiTarget target)
        {
            if (target == null || IsLikelyCanvasTarget(target, null)) return false;
            var inRibbon = false;
            if (target.Ancestors != null)
            {
                foreach (var ancestor in target.Ancestors)
                {
                    if ((ancestor.Name ?? "").IndexOf("Ribbon", StringComparison.OrdinalIgnoreCase) >= 0 ||
                        (ancestor.AutomationId ?? "").IndexOf("Tab", StringComparison.OrdinalIgnoreCase) >= 0)
                    {
                        inRibbon = true;
                        break;
                    }
                }
            }
            if (!inRibbon) return false;
            var role = target.Role ?? "";
            return role.IndexOf("Button", StringComparison.OrdinalIgnoreCase) >= 0 ||
                   role.IndexOf("Text", StringComparison.OrdinalIgnoreCase) >= 0 ||
                   role.IndexOf("Menu", StringComparison.OrdinalIgnoreCase) >= 0;
        }

        private static bool IsDynamicInputTarget(UiTarget target)
        {
            if (target == null) return false;
            if ((target.Name ?? "").IndexOf("CAcDynInputWndControl", StringComparison.OrdinalIgnoreCase) >= 0 ||
                (target.ClassName ?? "").IndexOf("CAcDynInputWndControl", StringComparison.OrdinalIgnoreCase) >= 0)
                return true;
            if (target.Ancestors == null) return false;
            foreach (var ancestor in target.Ancestors)
            {
                if ((ancestor.Name ?? "").IndexOf("CAcDynInputWndControl", StringComparison.OrdinalIgnoreCase) >= 0 ||
                    (ancestor.ClassName ?? "").IndexOf("CAcDynInputWndControl", StringComparison.OrdinalIgnoreCase) >= 0)
                    return true;
            }
            return false;
        }

        private static string DetectVisualModificationCommand(RawInputEvent input)
        {
            var text = new StringBuilder();
            if (!string.IsNullOrEmpty(input.Text)) text.Append(input.Text).Append(' ');
            if (!string.IsNullOrEmpty(input.Key)) text.Append(input.Key).Append(' ');
            AppendTargetText(text, input.Target);
            return DetectVisualModificationCommandText(text.ToString());
        }

        private static void AppendTargetText(StringBuilder text, UiTarget target)
        {
            if (target == null) return;
            text.Append(target.Name).Append(' ')
                .Append(target.AutomationId).Append(' ')
                .Append(target.ClassName).Append(' ');
            if (target.Ancestors == null) return;
            foreach (var ancestor in target.Ancestors)
            {
                text.Append(ancestor.Name).Append(' ')
                    .Append(ancestor.AutomationId).Append(' ')
                    .Append(ancestor.ClassName).Append(' ');
            }
        }

        private static string DetectVisualModificationCommandText(string text)
        {
            if (string.IsNullOrWhiteSpace(text)) return null;
            var value = text.Trim().TrimStart('_', '.', '-').ToUpperInvariant();
            var aliases = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
            {
                { "OF", "OFFSET" }, { "TR", "TRIM" }, { "EX", "EXTEND" },
                { "F", "FILLET" }, { "CHA", "CHAMFER" }, { "BR", "BREAK" },
                { "S", "STRETCH" }, { "M", "MOVE" }, { "CO", "COPY" },
                { "CP", "COPY" }, { "RO", "ROTATE" }, { "SC", "SCALE" }, { "MI", "MIRROR" }
            };
            string aliased;
            if (aliases.TryGetValue(value, out aliased)) return aliased;
            var commands = new[]
            {
                "OFFSET", "TRIM", "EXTEND", "FILLET", "CHAMFER", "BREAK",
                "STRETCH", "MOVE", "COPY", "ROTATE", "SCALE", "MIRROR"
            };
            foreach (var command in commands)
            {
                if (ContainsCommandToken(value, command) || value.Contains("ID_" + command.ToUpperInvariant()))
                    return command;
            }
            return null;
        }

        private static bool ContainsCommandToken(string text, string command)
        {
            var index = 0;
            while ((index = text.IndexOf(command, index, StringComparison.OrdinalIgnoreCase)) >= 0)
            {
                var beforeOkay = index == 0 || !char.IsLetterOrDigit(text[index - 1]);
                var end = index + command.Length;
                var afterOkay = end >= text.Length || !char.IsLetterOrDigit(text[end]);
                if (beforeOkay && afterOkay) return true;
                index = end;
            }
            return false;
        }

        private static VisualChangeInfo MeasureVisualChange(Bitmap before, Bitmap after, WindowInfo window)
        {
            if (before == null || after == null || before.Width != after.Width || before.Height != after.Height)
                return null;

            var screen = SystemInformation.VirtualScreen;
            var left = window == null ? screen.Left : Math.Max(screen.Left, window.X);
            var top = window == null ? screen.Top : Math.Max(screen.Top, window.Y);
            var right = window == null ? screen.Right : Math.Min(screen.Right, window.X + window.Width);
            var bottom = window == null ? screen.Bottom : Math.Min(screen.Bottom, window.Y + window.Height);
            if (right <= left || bottom <= top) return null;

            const int sampleStep = 4;
            const int colorThreshold = 54;
            var changed = 0;
            var sampled = 0;
            var minX = right;
            var minY = bottom;
            var maxX = left;
            var maxY = top;

            for (var screenY = top; screenY < bottom; screenY += sampleStep)
            {
                var bitmapY = screenY - screen.Top;
                for (var screenX = left; screenX < right; screenX += sampleStep)
                {
                    var bitmapX = screenX - screen.Left;
                    var first = before.GetPixel(bitmapX, bitmapY);
                    var second = after.GetPixel(bitmapX, bitmapY);
                    sampled++;
                    var delta = Math.Abs(first.R - second.R) + Math.Abs(first.G - second.G) + Math.Abs(first.B - second.B);
                    if (delta < colorThreshold) continue;
                    changed++;
                    if (screenX < minX) minX = screenX;
                    if (screenY < minY) minY = screenY;
                    if (screenX > maxX) maxX = screenX;
                    if (screenY > maxY) maxY = screenY;
                }
            }

            var ratio = sampled == 0 ? 0 : (double)changed / sampled;
            var significant = changed >= 8 && ratio >= 0.00005;
            var result = new VisualChangeInfo
            {
                Changed = significant,
                ChangedPixelRatio = Math.Round(ratio, 8),
                SampleStep = sampleStep
            };
            if (changed > 0)
            {
                result.X = minX;
                result.Y = minY;
                result.Width = Math.Max(sampleStep, maxX - minX + sampleStep);
                result.Height = Math.Max(sampleStep, maxY - minY + sampleStep);
                if (window != null && window.Width > 0 && window.Height > 0)
                {
                    result.RelativeBounds = new[]
                    {
                        Clamp01((double)(result.X - window.X) / window.Width),
                        Clamp01((double)(result.Y - window.Y) / window.Height),
                        Clamp01((double)result.Width / window.Width),
                        Clamp01((double)result.Height / window.Height)
                    };
                }
            }
            return result;
        }

        private static double Clamp01(double value)
        {
            return Math.Round(Math.Max(0, Math.Min(1, value)), 6);
        }

        private static UiTarget ReadTargetAt(int x, int y)
        {
            try
            {
                var element = AutomationElement.FromPoint(new System.Windows.Point(x, y));
                return ReadTarget(element);
            }
            catch
            {
                return null;
            }
        }

        private static UiTarget ReadTarget(AutomationElement element)
        {
            if (element == null) return null;
            var rectangle = element.Current.BoundingRectangle;
            return new UiTarget
            {
                Name = SafeValue(delegate { return element.Current.Name; }),
                Role = SafeValue(delegate { return element.Current.ControlType == null ? null : element.Current.ControlType.ProgrammaticName; }),
                AutomationId = SafeValue(delegate { return element.Current.AutomationId; }),
                ClassName = SafeValue(delegate { return element.Current.ClassName; }),
                X = (int)rectangle.X,
                Y = (int)rectangle.Y,
                Width = (int)rectangle.Width,
                Height = (int)rectangle.Height,
                Ancestors = ReadTargetAncestors(element)
            };
        }

        private static List<UiAncestor> ReadTargetAncestors(AutomationElement element)
        {
            var result = new List<UiAncestor>();
            try
            {
                var current = element;
                for (var depth = 0; depth < 8; depth++)
                {
                    current = TreeWalker.ControlViewWalker.GetParent(current);
                    if (current == null) break;
                    var name = SafeValue(delegate { return current.Current.Name; });
                    var role = SafeValue(delegate
                    {
                        return current.Current.ControlType == null
                            ? null
                            : current.Current.ControlType.ProgrammaticName;
                    });
                    var automationId = SafeValue(delegate { return current.Current.AutomationId; });
                    var className = SafeValue(delegate { return current.Current.ClassName; });
                    if (string.IsNullOrWhiteSpace(name) && string.IsNullOrWhiteSpace(automationId)) continue;
                    result.Add(new UiAncestor
                    {
                        Name = name,
                        Role = role,
                        AutomationId = automationId,
                        ClassName = className
                    });
                }
            }
            catch
            {
                // Some transient AutoCAD popup elements disappear while their ancestry is read.
            }
            return result;
        }

        private void ReadKeyboardCaptureContext(out UiTarget target, out bool isPassword)
        {
            target = null;
#if PSCAD || QUARTUS
            // No control-tree query, including a UIA password probe. Privacy pause
            // remains available via Ctrl+Shift+F12 before sensitive input.
            isPassword = false;
#else
            if (_captureUiAutomationTargets)
                ReadFocusedContext(out target, out isPassword);
            else
                ReadFocusedPasswordState(out isPassword);
#endif
        }

        private static void ReadFocusedContext(out UiTarget target, out bool isPassword)
        {
            target = null;
            isPassword = false;
            try
            {
                var element = AutomationElement.FocusedElement;
                if (element == null) return;
                isPassword = element.Current.IsPassword;
                target = ReadTarget(element);
            }
            catch { }
        }

        private static void ReadFocusedPasswordState(out bool isPassword)
        {
            isPassword = false;
            try
            {
                var element = AutomationElement.FocusedElement;
                if (element != null) isPassword = element.Current.IsPassword;
            }
            catch { }
        }

        private static WindowInfo ReadForegroundWindow()
        {
            return ReadWindowInfo(GetForegroundWindow());
        }

        private static WindowInfo ReadWindowAtPoint(int x, int y)
        {
            var handle = WindowFromPoint(new Point(x, y));
            if (handle != IntPtr.Zero)
            {
                var root = GetAncestor(handle, 2);
                if (root != IntPtr.Zero) handle = root;
            }
            return ReadWindowInfo(handle);
        }

        private static WindowInfo ReadWindowInfo(IntPtr handle)
        {
            if (handle == IntPtr.Zero) return null;
            var text = new StringBuilder(512);
            GetWindowText(handle, text, text.Capacity);
            Rect rectangle;
            GetWindowRect(handle, out rectangle);
            uint processId;
            GetWindowThreadProcessId(handle, out processId);
            string processName = null;
            try { processName = Process.GetProcessById((int)processId).ProcessName; } catch { }
            return new WindowInfo
            {
#if QUARTUS
                Handle = handle.ToInt64().ToString("X"),
#endif
                Title = text.ToString(),
                ProcessName = processName,
                ProcessId = (int)processId,
                X = rectangle.Left,
                Y = rectangle.Top,
                Width = rectangle.Right - rectangle.Left,
                Height = rectangle.Bottom - rectangle.Top
            };
        }

        private static string SafeValue(Func<string> getter)
        {
            try { return getter(); } catch { return null; }
        }

        private static string TranslateKey(uint virtualKey, uint scanCode)
        {
            var keyboardState = new byte[256];
            if (!GetKeyboardState(keyboardState)) return null;
            var buffer = new StringBuilder(8);
            var foreground = GetForegroundWindow();
            uint processId;
            var threadId = GetWindowThreadProcessId(foreground, out processId);
            var layout = GetKeyboardLayout(threadId);
            var result = ToUnicodeEx(virtualKey, scanCode, keyboardState, buffer, buffer.Capacity, 0, layout);
            return result > 0 ? buffer.ToString() : null;
        }

        private static List<string> GetModifiers()
        {
            var result = new List<string>();
            if ((GetKeyState((int)Keys.ControlKey) & 0x8000) != 0) result.Add("CTRL");
            if ((GetKeyState((int)Keys.ShiftKey) & 0x8000) != 0) result.Add("SHIFT");
            if ((GetKeyState((int)Keys.Menu) & 0x8000) != 0) result.Add("ALT");
            if ((GetKeyState((int)Keys.LWin) & 0x8000) != 0 || (GetKeyState((int)Keys.RWin) & 0x8000) != 0) result.Add("WIN");
            return result;
        }

        private static bool IsModifierKey(uint virtualKey)
        {
            var key = (Keys)virtualKey;
            return key == Keys.ControlKey || key == Keys.LControlKey || key == Keys.RControlKey ||
                   key == Keys.ShiftKey || key == Keys.LShiftKey || key == Keys.RShiftKey ||
                   key == Keys.Menu || key == Keys.LMenu || key == Keys.RMenu ||
                   key == Keys.LWin || key == Keys.RWin;
        }

        private static string NormalizeKeyName(string key)
        {
            if (key == "RETURN") return "ENTER";
            if (key == "BACK") return "BACKSPACE";
            return key;
        }

        private static string MouseEventType(int message)
        {
            if (message == WmMouseMove) return "mouse_move";
            if (message == WmLButtonDown || message == WmRButtonDown || message == WmMButtonDown) return "mouse_down";
            if (message == WmLButtonUp || message == WmRButtonUp || message == WmMButtonUp) return "mouse_up";
            if (message == WmMouseWheel) return "mouse_wheel";
            return null;
        }

        private static string MouseButton(int message)
        {
            if (message == WmLButtonDown || message == WmLButtonUp) return "left";
            if (message == WmRButtonDown || message == WmRButtonUp) return "right";
            if (message == WmMButtonDown || message == WmMButtonUp) return "middle";
            return null;
        }

        private string NextId()
        {
            return "evt-" + Interlocked.Increment(ref _eventSequence).ToString("D8");
        }

        private static long UtcNowMs()
        {
            return DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        }

        private static double Distance(Point first, Point second)
        {
            var dx = first.X - second.X;
            var dy = first.Y - second.Y;
            return Math.Sqrt(dx * dx + dy * dy);
        }

        [DataContract]
        private sealed class RawInputEvent
        {
#if PSCAD || QUARTUS
            [DataMember(Name = "screenshotDesktopBounds")] public int[] ScreenshotDesktopBounds;
#endif
            [DataMember(Name = "id", EmitDefaultValue = false)] public string Id;
            [DataMember(Name = "eventType", EmitDefaultValue = false)] public string EventType;
            [DataMember(Name = "timestampMs")] public long TimestampMs;
            [DataMember(Name = "x", EmitDefaultValue = false)] public int X;
            [DataMember(Name = "y", EmitDefaultValue = false)] public int Y;
            [DataMember(Name = "relativeX", EmitDefaultValue = false)] public double RelativeX;
            [DataMember(Name = "relativeY", EmitDefaultValue = false)] public double RelativeY;
            [DataMember(Name = "button", EmitDefaultValue = false)] public string Button;
            [DataMember(Name = "wheelDelta", EmitDefaultValue = false)] public int WheelDelta;
            [DataMember(Name = "key", EmitDefaultValue = false)] public string Key;
            [DataMember(Name = "text", EmitDefaultValue = false)] public string Text;
            [DataMember(Name = "modifiers", EmitDefaultValue = false)] public string[] Modifiers;
            [DataMember(Name = "window", EmitDefaultValue = false)] public WindowInfo Window;
            [DataMember(Name = "target", EmitDefaultValue = false)] public UiTarget Target;
            [DataMember(Name = "screenshot", EmitDefaultValue = false)] public string Screenshot;
            [DataMember(Name = "screenshotTimestampMs", EmitDefaultValue = false)] public long ScreenshotTimestampMs;
            [DataMember(Name = "screenshotBefore", EmitDefaultValue = false)] public string ScreenshotBefore;
            [DataMember(Name = "screenshotBeforeTimestampMs", EmitDefaultValue = false)] public long ScreenshotBeforeTimestampMs;
            [DataMember(Name = "screenshotAfter", EmitDefaultValue = false)] public string ScreenshotAfter;
            [DataMember(Name = "screenshotAfterTimestampMs", EmitDefaultValue = false)] public long ScreenshotAfterTimestampMs;
            [DataMember(Name = "screenshotSelection", EmitDefaultValue = false)] public string ScreenshotSelection;
            [DataMember(Name = "screenshotSelectionTimestampMs", EmitDefaultValue = false)] public long ScreenshotSelectionTimestampMs;
#if JMP || VIVADO || ORCAD
            [DataMember(Name = "screenshotSettledAfter", EmitDefaultValue = false)] public string ScreenshotSettledAfter;
            [DataMember(Name = "screenshotSettledAfterTimestampMs", EmitDefaultValue = false)] public long ScreenshotSettledAfterTimestampMs;
#endif
            [DataMember(Name = "visualCommandContext", EmitDefaultValue = false)] public string VisualCommandContext;
            [DataMember(Name = "visualChange", EmitDefaultValue = false)] public VisualChangeInfo VisualChange;
            [DataMember(Name = "transformEvidence", EmitDefaultValue = false)] public List<ScreenshotRegionEvidence> TransformEvidence;
            [DataMember(Name = "error", EmitDefaultValue = false)] public string Error;
            public Bitmap Snapshot;
            public long SnapshotTimestampMs;
        }

        [DataContract]
        private sealed class VisualChangeInfo
        {
            [DataMember(Name = "changed")] public bool Changed;
            [DataMember(Name = "changedPixelRatio")] public double ChangedPixelRatio;
            [DataMember(Name = "sampleStep")] public int SampleStep;
            [DataMember(Name = "x", EmitDefaultValue = false)] public int X;
            [DataMember(Name = "y", EmitDefaultValue = false)] public int Y;
            [DataMember(Name = "width", EmitDefaultValue = false)] public int Width;
            [DataMember(Name = "height", EmitDefaultValue = false)] public int Height;
            [DataMember(Name = "relativeBounds", EmitDefaultValue = false)] public double[] RelativeBounds;
        }

        [DataContract]
        private sealed class WindowInfo
        {
#if QUARTUS
            [DataMember(Name = "handle", EmitDefaultValue = false)] public string Handle;
#endif
            [DataMember(Name = "title", EmitDefaultValue = false)] public string Title;
            [DataMember(Name = "processName", EmitDefaultValue = false)] public string ProcessName;
            [DataMember(Name = "processId")] public int ProcessId;
            [DataMember(Name = "x")] public int X;
            [DataMember(Name = "y")] public int Y;
            [DataMember(Name = "width")] public int Width;
            [DataMember(Name = "height")] public int Height;
        }

        [DataContract]
        private sealed class UiTarget
        {
            [DataMember(Name = "name", EmitDefaultValue = false)] public string Name;
            [DataMember(Name = "role", EmitDefaultValue = false)] public string Role;
            [DataMember(Name = "automationId", EmitDefaultValue = false)] public string AutomationId;
            [DataMember(Name = "className", EmitDefaultValue = false)] public string ClassName;
            [DataMember(Name = "x")] public int X;
            [DataMember(Name = "y")] public int Y;
            [DataMember(Name = "width")] public int Width;
            [DataMember(Name = "height")] public int Height;
            [DataMember(Name = "ancestors", EmitDefaultValue = false)] public List<UiAncestor> Ancestors;
        }

        [DataContract]
        private sealed class ScreenshotRegionEvidence
        {
            [DataMember(Name = "kind")] public string Kind;
            [DataMember(Name = "phase")] public string Phase;
            [DataMember(Name = "screenshot")] public string Screenshot;
            [DataMember(Name = "relativeBounds")] public double[] RelativeBounds;
            [DataMember(Name = "pixelBounds")] public int[] PixelBounds;
        }

        [DataContract]
        private sealed class UiAncestor
        {
            [DataMember(Name = "name", EmitDefaultValue = false)] public string Name;
            [DataMember(Name = "role", EmitDefaultValue = false)] public string Role;
            [DataMember(Name = "automationId", EmitDefaultValue = false)] public string AutomationId;
            [DataMember(Name = "className", EmitDefaultValue = false)] public string ClassName;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct MsLlHookStruct
        {
            public Point Point;
            public uint MouseData;
            public uint Flags;
            public uint Time;
            public IntPtr ExtraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct KbdLlHookStruct
        {
            public uint VirtualKeyCode;
            public uint ScanCode;
            public uint Flags;
            public uint Time;
            public IntPtr ExtraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct Rect
        {
            public int Left;
            public int Top;
            public int Right;
            public int Bottom;
        }

        private delegate IntPtr LowLevelMouseProc(int code, IntPtr message, IntPtr data);
        private delegate IntPtr LowLevelKeyboardProc(int code, IntPtr message, IntPtr data);

        [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelMouseProc callback, IntPtr module, uint threadId);
        [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc callback, IntPtr module, uint threadId);
        [DllImport("user32.dll")] private static extern bool UnhookWindowsHookEx(IntPtr hook);
        [DllImport("user32.dll")] private static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr message, IntPtr data);
        [DllImport("kernel32.dll", CharSet = CharSet.Auto)] private static extern IntPtr GetModuleHandle(string moduleName);
        [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] private static extern IntPtr WindowFromPoint(Point point);
        [DllImport("user32.dll")] private static extern IntPtr GetAncestor(IntPtr window, uint flags);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr window, StringBuilder text, int count);
        [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr window, out Rect rectangle);
        [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
        [DllImport("user32.dll")] private static extern short GetKeyState(int virtualKey);
        [DllImport("user32.dll")] private static extern bool GetKeyboardState(byte[] state);
        [DllImport("user32.dll")] private static extern IntPtr GetKeyboardLayout(uint threadId);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int ToUnicodeEx(uint virtualKey, uint scanCode, byte[] state, StringBuilder buffer, int capacity, uint flags, IntPtr layout);
    }
}
