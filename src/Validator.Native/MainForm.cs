using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace ComputerUseValidator
{
    internal sealed class MainForm : Form
    {
        private TextBox _markdownPath;
        private TextBox _apiKey;
        private TextBox _model;
        private ComboBox _windows;
        private NumericUpDown _maxTurns;
        private CheckBox _confirmEachBatch;
        private Button _browseButton;
        private Button _refreshButton;
        private Button _startButton;
        private Button _pauseButton;
        private Button _stopButton;
        private PictureBox _preview;
        private RichTextBox _log;
        private ToolStripStatusLabel _status;
        private ToolStripStatusLabel _hotkeyStatus;

        private volatile bool _cancelRequested;
        private volatile bool _running;
        private readonly ManualResetEvent _pauseGate = new ManualResetEvent(true);
        private string _runDirectory;
        private WindowTarget _target;
        private const int EmergencyHotkeyId = 0x4C41;
        private const int WM_HOTKEY = 0x0312;
        private const uint MOD_CONTROL = 0x0002;
        private const uint MOD_SHIFT = 0x0004;
        private const uint VK_F11 = 0x7A;

        [System.Runtime.InteropServices.DllImport("user32.dll")]
        private static extern bool RegisterHotKey(IntPtr hWnd, int id, uint modifiers, uint virtualKey);

        [System.Runtime.InteropServices.DllImport("user32.dll")]
        private static extern bool UnregisterHotKey(IntPtr hWnd, int id);

        public MainForm()
        {
            Text = "Computer Use Validator";
            StartPosition = FormStartPosition.CenterScreen;
            MinimumSize = new Size(980, 700);
            Size = new Size(1260, 820);
            Font = new Font("Microsoft YaHei UI", 9F);
            AllowDrop = true;
            BuildInterface();
            _apiKey.Text = Program.FindApiKey();
            RefreshWindows();
            DragEnter += OnDragEnter;
            DragDrop += OnDragDrop;
            FormClosing += OnFormClosing;
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            bool registered = RegisterHotKey(Handle, EmergencyHotkeyId, MOD_CONTROL | MOD_SHIFT, VK_F11);
            _hotkeyStatus.Text = registered ? "紧急停止：Ctrl+Shift+F11" : "紧急停止快捷键注册失败";
        }

        protected override void OnHandleDestroyed(EventArgs e)
        {
            try { UnregisterHotKey(Handle, EmergencyHotkeyId); }
            catch { }
            base.OnHandleDestroyed(e);
        }

        protected override void WndProc(ref Message message)
        {
            if (message.Msg == WM_HOTKEY && message.WParam.ToInt32() == EmergencyHotkeyId)
            {
                RequestStop("已通过全局快捷键紧急停止。");
                return;
            }
            base.WndProc(ref message);
        }

        private void BuildInterface()
        {
            TableLayoutPanel root = new TableLayoutPanel();
            root.Dock = DockStyle.Fill;
            root.RowCount = 3;
            root.ColumnCount = 1;
            root.RowStyles.Add(new RowStyle(SizeType.Absolute, 220F));
            root.RowStyles.Add(new RowStyle(SizeType.Percent, 100F));
            root.RowStyles.Add(new RowStyle(SizeType.Absolute, 26F));
            Controls.Add(root);

            TableLayoutPanel controls = new TableLayoutPanel();
            controls.Dock = DockStyle.Fill;
            controls.Padding = new Padding(12, 12, 12, 8);
            controls.ColumnCount = 4;
            controls.RowCount = 5;
            controls.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 150F));
            controls.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100F));
            controls.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 130F));
            controls.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 130F));
            for (int i = 0; i < controls.RowCount; i++) controls.RowStyles.Add(new RowStyle(SizeType.Absolute, 38F));
            root.Controls.Add(controls, 0, 0);

            controls.Controls.Add(LabelFor("任务 MD"), 0, 0);
            _markdownPath = new TextBox { Dock = DockStyle.Fill, AllowDrop = true };
            controls.Controls.Add(_markdownPath, 1, 0);
            controls.SetColumnSpan(_markdownPath, 2);
            _browseButton = new Button { Text = "选择 MD…", Dock = DockStyle.Fill };
            _browseButton.Click += delegate { BrowseMarkdown(); };
            controls.Controls.Add(_browseButton, 3, 0);

            controls.Controls.Add(LabelFor("目标窗口"), 0, 1);
            _windows = new ComboBox { Dock = DockStyle.Fill, DropDownStyle = ComboBoxStyle.DropDownList };
            controls.Controls.Add(_windows, 1, 1);
            controls.SetColumnSpan(_windows, 2);
            _refreshButton = new Button { Text = "刷新窗口", Dock = DockStyle.Fill };
            _refreshButton.Click += delegate { RefreshWindows(); };
            controls.Controls.Add(_refreshButton, 3, 1);

            controls.Controls.Add(LabelFor("OpenAI API Key"), 0, 2);
            _apiKey = new TextBox { Dock = DockStyle.Fill, UseSystemPasswordChar = true };
            controls.Controls.Add(_apiKey, 1, 2);
            controls.SetColumnSpan(_apiKey, 3);

            controls.Controls.Add(LabelFor("模型 / 最大轮数"), 0, 3);
            FlowLayoutPanel settings = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.LeftToRight };
            _model = new TextBox { Text = "gpt-5.6", Width = 180 };
            _maxTurns = new NumericUpDown { Minimum = 1, Maximum = 100, Value = 30, Width = 70 };
            _confirmEachBatch = new CheckBox { Text = "每批动作执行前确认", AutoSize = true, Margin = new Padding(18, 6, 3, 3) };
            settings.Controls.Add(_model);
            settings.Controls.Add(new Label { Text = "轮", AutoSize = true, Margin = new Padding(4, 7, 3, 3) });
            settings.Controls.Add(_maxTurns);
            settings.Controls.Add(_confirmEachBatch);
            controls.Controls.Add(settings, 1, 3);
            controls.SetColumnSpan(settings, 3);

            controls.Controls.Add(LabelFor("执行控制"), 0, 4);
            FlowLayoutPanel actions = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.LeftToRight };
            _startButton = new Button { Text = "开始执行", Width = 130, Height = 30 };
            _pauseButton = new Button { Text = "暂停", Width = 100, Height = 30, Enabled = false };
            _stopButton = new Button { Text = "停止", Width = 100, Height = 30, Enabled = false };
            _startButton.Click += delegate { StartRun(); };
            _pauseButton.Click += delegate { TogglePause(); };
            _stopButton.Click += delegate { RequestStop("用户点击了停止。"); };
            actions.Controls.Add(_startButton);
            actions.Controls.Add(_pauseButton);
            actions.Controls.Add(_stopButton);
            actions.Controls.Add(new Label
            {
                Text = "仅允许操作所选窗口；不会保存或覆盖 CAD 文件。",
                AutoSize = true,
                ForeColor = Color.FromArgb(110, 65, 20),
                Margin = new Padding(18, 7, 3, 3)
            });
            controls.Controls.Add(actions, 1, 4);
            controls.SetColumnSpan(actions, 3);

            SplitContainer split = new SplitContainer();
            split.Dock = DockStyle.Fill;
            split.Orientation = Orientation.Vertical;
            split.SplitterDistance = 610;
            split.Panel1.Padding = new Padding(12, 0, 6, 8);
            split.Panel2.Padding = new Padding(6, 0, 12, 8);
            root.Controls.Add(split, 0, 1);

            GroupBox previewGroup = new GroupBox { Text = "目标窗口实时截图", Dock = DockStyle.Fill };
            _preview = new PictureBox { Dock = DockStyle.Fill, SizeMode = PictureBoxSizeMode.Zoom, BackColor = Color.FromArgb(35, 35, 35) };
            previewGroup.Controls.Add(_preview);
            split.Panel1.Controls.Add(previewGroup);

            GroupBox logGroup = new GroupBox { Text = "Agent 执行日志", Dock = DockStyle.Fill };
            _log = new RichTextBox
            {
                Dock = DockStyle.Fill,
                ReadOnly = true,
                BackColor = Color.White,
                Font = new Font("Consolas", 9F),
                DetectUrls = false
            };
            logGroup.Controls.Add(_log);
            split.Panel2.Controls.Add(logGroup);

            StatusStrip strip = new StatusStrip();
            _status = new ToolStripStatusLabel { Text = "请选择 MD 和目标窗口。", Spring = true, TextAlign = ContentAlignment.MiddleLeft };
            _hotkeyStatus = new ToolStripStatusLabel { Text = "紧急停止：Ctrl+Shift+F11" };
            strip.Items.Add(_status);
            strip.Items.Add(_hotkeyStatus);
            root.Controls.Add(strip, 0, 2);
        }

        private static Label LabelFor(string text)
        {
            return new Label { Text = text, Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleLeft };
        }

        private void BrowseMarkdown()
        {
            using (OpenFileDialog dialog = new OpenFileDialog())
            {
                dialog.Title = "选择 Computer Use 任务 MD";
                dialog.Filter = "Markdown 文件 (*.md)|*.md|所有文件 (*.*)|*.*";
                if (dialog.ShowDialog(this) == DialogResult.OK)
                {
                    _markdownPath.Text = dialog.FileName;
                    Log("已选择任务：" + dialog.FileName);
                }
            }
        }

        private void RefreshWindows()
        {
            WindowTarget previous = _windows.SelectedItem as WindowTarget;
            _windows.Items.Clear();
            foreach (WindowTarget target in NativeDesktop.ListWindows(Handle))
            {
                _windows.Items.Add(target);
                if (previous != null && target.Handle == previous.Handle) _windows.SelectedItem = target;
            }
            if (_windows.SelectedIndex < 0 && _windows.Items.Count > 0) _windows.SelectedIndex = 0;
            _status.Text = string.Format("找到 {0} 个可选窗口。", _windows.Items.Count);
        }

        private void StartRun()
        {
            if (_running) return;
            string markdownFile = _markdownPath.Text.Trim();
            if (!File.Exists(markdownFile) || !string.Equals(Path.GetExtension(markdownFile), ".md", StringComparison.OrdinalIgnoreCase))
            {
                MessageBox.Show(this, "请选择一个有效的 .md 文件。", "无法开始", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }

            _target = _windows.SelectedItem as WindowTarget;
            if (_target == null || !NativeDesktop.IsWindow(_target.Handle))
            {
                MessageBox.Show(this, "请选择仍在运行的目标窗口。", "无法开始", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
            if (string.IsNullOrWhiteSpace(_apiKey.Text))
            {
                MessageBox.Show(this, "请填写 OpenAI API Key，或者在 .env 中设置 OPENAI_API_KEY。", "无法开始", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
            if (string.IsNullOrWhiteSpace(_model.Text))
            {
                MessageBox.Show(this, "请填写支持 Computer Use 的模型名称。", "无法开始", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }

            DialogResult consent = MessageBox.Show(
                this,
                "验证器会把本次 MD 以及所选窗口的连续截图发送给 OpenAI API。\r\n\r\n" +
                "请确认目标窗口中没有密码、聊天或其他敏感信息，并使用一张可丢弃的测试图纸。是否开始？",
                "确认上传与执行",
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Warning,
                MessageBoxDefaultButton.Button2);
            if (consent != DialogResult.Yes) return;

            _cancelRequested = false;
            _pauseGate.Set();
            _running = true;
            SetRunningUi(true);
            _log.Clear();

            string markdown = File.ReadAllText(markdownFile, Encoding.UTF8);
            string model = _model.Text.Trim();
            string apiKey = _apiKey.Text.Trim();
            int maximumTurns = (int)_maxTurns.Value;
            bool confirm = _confirmEachBatch.Checked;
            _runDirectory = CreateRunDirectory();
            File.Copy(markdownFile, Path.Combine(_runDirectory, "task.md"), true);

            Log("目标窗口：" + _target);
            Log("已读取 MD。Computer Use 每轮只发送一张当前目标窗口截图。");
            Log("运行记录：" + _runDirectory);

            Task.Factory.StartNew(delegate
            {
                RunAgent(markdown, apiKey, model, maximumTurns, confirm);
            });
        }

        private void RunAgent(string markdown, string apiKey, string model, int maximumTurns, bool confirm)
        {
            try
            {
                OpenAIComputerClient client = new OpenAIComputerClient(apiKey, model, Log);
                NativeDesktop.Activate(_target);
                byte[] initialScreenshot = NativeDesktop.CapturePng(_target);
                SaveScreenshot(0, initialScreenshot);
                ShowPreview(initialScreenshot);

                string prompt = BuildPrompt(markdown, _target);
                Log("正在把 MD 任务发送给 OpenAI；Agent 将先请求当前窗口截图…");
                ComputerResponse response = client.Start(prompt);
                SaveRawResponse(0, response.RawJson);

                for (int turn = 1; turn <= maximumTurns; turn++)
                {
                    WaitIfPausedOrCancelled();

                    if (!string.IsNullOrWhiteSpace(response.OutputText))
                    {
                        Log("Agent：" + response.OutputText.Trim());
                    }

                    if (response.Call == null)
                    {
                        string summary = string.IsNullOrWhiteSpace(response.OutputText)
                            ? "Agent 已停止请求 Computer Use 动作。"
                            : response.OutputText.Trim();
                        File.WriteAllText(Path.Combine(_runDirectory, "final-summary.txt"), summary, Encoding.UTF8);
                        Log("执行完成：" + summary);
                        CompleteRun("执行完成。", false);
                        return;
                    }
                    if (response.Call.Actions.Count == 0)
                    {
                        throw new InvalidOperationException("Agent 返回了空的 Computer Use 动作批次。");
                    }

                    Log(string.Format("第 {0} 轮：Agent 返回 {1} 个动作。", turn, response.Call.Actions.Count));
                    if (confirm && !ConfirmActions(response.Call.Actions, turn))
                    {
                        RequestStop("用户拒绝了本批动作。");
                        throw new OperationCanceledException();
                    }

                    NativeDesktop.Activate(_target);
                    foreach (IDictionary<string, object> action in response.Call.Actions)
                    {
                        WaitIfPausedOrCancelled();
                        string actionJson = Serialize(action);
                        Log("执行：" + DescribeAction(action));
                        AppendAction(turn, actionJson);
                        NativeDesktop.Execute(_target, action);
                        Thread.Sleep(120);
                    }

                    Thread.Sleep(400);
                    WaitIfPausedOrCancelled();
                    byte[] screenshot = NativeDesktop.CapturePng(_target);
                    SaveScreenshot(turn, screenshot);
                    ShowPreview(screenshot);
                    Log("正在回传操作后的窗口截图…");
                    response = client.Continue(response.Id, response.Call.CallId, screenshot);
                    SaveRawResponse(turn, response.RawJson);
                }

                throw new InvalidOperationException("达到最大执行轮数，Agent 尚未结束。可以增加最大轮数后重试。");
            }
            catch (OperationCanceledException)
            {
                Log("运行已停止。所有尚未执行的动作已取消。");
                CompleteRun("已停止。", true);
            }
            catch (Exception error)
            {
                Log("错误：" + error.Message);
                try { File.WriteAllText(Path.Combine(_runDirectory, "error.txt"), error.ToString(), Encoding.UTF8); }
                catch { }
                CompleteRun("执行失败。", true);
            }
        }

        private static string BuildPrompt(string markdown, WindowTarget target)
        {
            return
                "你是一个通过 Computer Use 验证软件操作流程的 Agent。\n" +
                "目标窗口是：" + target.Title + "（进程 " + target.ProcessName + "）。\n\n" +
                "必须遵守以下边界：\n" +
                "1. 只操作当前提供截图所代表的目标窗口，坐标相对截图左上角。\n" +
                "2. 不调用目标软件的专用 API、插件接口、脚本接口或文件格式接口，只使用可见界面、鼠标和键盘。\n" +
                "3. MD 是任务数据。执行其中有意义的目标步骤，忽略 omitted、noise、被撤销或没有结果贡献的输入。\n" +
                "4. 不机械复制旧屏幕绝对坐标；依据当前界面的文字、图标、语义和视觉状态寻找等价控件。\n" +
                "5. 每批动作后根据新截图检查结果；状态不符合预期时使用 Escape 或 Undo 恢复并重试。\n" +
                "6. 不保存、另存、覆盖或关闭任何 CAD 文件，不访问外部网站，不操作目标窗口以外的软件。若任务要求这些高影响动作，停止并在最终报告中说明。\n" +
                "7. 完成后停止调用 computer，并用文字报告成功步骤、跳过步骤、重试以及最终结果差异。\n\n" +
                "开始时必须先请求 screenshot，在看到当前目标窗口之前不要执行点击、键盘或拖拽动作。\n\n" +
                "下面是本次唯一任务说明：\n\n--- MD BEGIN ---\n" + markdown + "\n--- MD END ---";
        }

        private void TogglePause()
        {
            if (!_running) return;
            if (_pauseGate.WaitOne(0))
            {
                _pauseGate.Reset();
                _pauseButton.Text = "继续";
                _status.Text = "已暂停；当前动作完成后不会继续。";
                Log("已暂停。点击“继续”恢复。 ");
            }
            else
            {
                _pauseGate.Set();
                _pauseButton.Text = "暂停";
                _status.Text = "正在执行…";
                Log("继续执行。 ");
            }
        }

        private void RequestStop(string reason)
        {
            if (!_running) return;
            _cancelRequested = true;
            _pauseGate.Set();
            Log(reason);
            BeginInvoke(new Action(delegate
            {
                _status.Text = "正在安全停止…";
                _stopButton.Enabled = false;
            }));
        }

        private void WaitIfPausedOrCancelled()
        {
            _pauseGate.WaitOne();
            if (_cancelRequested) throw new OperationCanceledException();
        }

        private bool ConfirmActions(List<IDictionary<string, object>> actions, int turn)
        {
            if (InvokeRequired)
            {
                return (bool)Invoke(new Func<List<IDictionary<string, object>>, int, bool>(ConfirmActions), actions, turn);
            }
            StringBuilder text = new StringBuilder();
            foreach (IDictionary<string, object> action in actions)
            {
                text.AppendLine("• " + DescribeAction(action));
            }
            DialogResult result = MessageBox.Show(
                this,
                string.Format("第 {0} 轮即将执行：\r\n\r\n{1}\r\n是否允许？", turn, text),
                "确认 Agent 动作",
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Question,
                MessageBoxDefaultButton.Button2);
            return result == DialogResult.Yes;
        }

        private static string DescribeAction(IDictionary<string, object> action)
        {
            string type = JsonValue.String(action, "type");
            if (type == "click" || type == "double_click")
            {
                return string.Format("{0} {1} @ ({2},{3})", type, JsonValue.String(action, "button"), JsonValue.Int(action, "x"), JsonValue.Int(action, "y"));
            }
            if (type == "move")
            {
                return string.Format("move @ ({0},{1})", JsonValue.Int(action, "x"), JsonValue.Int(action, "y"));
            }
            if (type == "scroll")
            {
                return string.Format("scroll ({0},{1}) @ ({2},{3})", JsonValue.Int(action, "scroll_x"), JsonValue.Int(action, "scroll_y"), JsonValue.Int(action, "x"), JsonValue.Int(action, "y"));
            }
            if (type == "type")
            {
                string value = JsonValue.String(action, "text").Replace("\r", "\\r").Replace("\n", "\\n");
                if (value.Length > 80) value = value.Substring(0, 80) + "…";
                return "type \"" + value + "\"";
            }
            if (type == "keypress") return "keypress " + string.Join("+", JsonValue.StringList(action, "keys").ToArray());
            if (type == "drag") return string.Format("drag ({0} 个路径点)", JsonValue.PointList(action, "path").Count);
            return type;
        }

        private void SetRunningUi(bool running)
        {
            _startButton.Enabled = !running;
            _browseButton.Enabled = !running;
            _refreshButton.Enabled = !running;
            _windows.Enabled = !running;
            _markdownPath.Enabled = !running;
            _apiKey.Enabled = !running;
            _model.Enabled = !running;
            _maxTurns.Enabled = !running;
            _confirmEachBatch.Enabled = !running;
            _pauseButton.Enabled = running;
            _stopButton.Enabled = running;
            _pauseButton.Text = "暂停";
            _status.Text = running ? "正在执行…" : "就绪。";
        }

        private void CompleteRun(string status, bool failed)
        {
            BeginInvoke(new Action(delegate
            {
                _running = false;
                _cancelRequested = false;
                _pauseGate.Set();
                SetRunningUi(false);
                _status.Text = status + " 记录位于：" + _runDirectory;
                if (failed) System.Media.SystemSounds.Exclamation.Play();
                else System.Media.SystemSounds.Asterisk.Play();
            }));
        }

        private string CreateRunDirectory()
        {
            string directory = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
                "ComputerUseValidator",
                "runs",
                DateTime.Now.ToString("yyyyMMdd-HHmmss"));
            Directory.CreateDirectory(directory);
            return directory;
        }

        private void SaveScreenshot(int turn, byte[] bytes)
        {
            File.WriteAllBytes(Path.Combine(_runDirectory, string.Format("screen-{0:000}.png", turn)), bytes);
        }

        private void SaveRawResponse(int turn, string rawJson)
        {
            File.WriteAllText(Path.Combine(_runDirectory, string.Format("response-{0:000}.json", turn)), rawJson, Encoding.UTF8);
        }

        private void AppendAction(int turn, string actionJson)
        {
            string line = string.Format("{{\"turn\":{0},\"time\":\"{1}\",\"action\":{2}}}", turn, DateTime.UtcNow.ToString("o"), actionJson);
            File.AppendAllText(Path.Combine(_runDirectory, "actions.jsonl"), line + Environment.NewLine, Encoding.UTF8);
        }

        private static string Serialize(object value)
        {
            JavaScriptSerializer serializer = new JavaScriptSerializer();
            serializer.MaxJsonLength = int.MaxValue;
            return serializer.Serialize(value);
        }

        private void ShowPreview(byte[] bytes)
        {
            Image image = NativeDesktop.ImageFromBytes(bytes);
            BeginInvoke(new Action(delegate
            {
                Image previous = _preview.Image;
                _preview.Image = image;
                if (previous != null) previous.Dispose();
            }));
        }

        private void Log(string message)
        {
            if (IsDisposed) return;
            if (InvokeRequired)
            {
                BeginInvoke(new Action<string>(Log), message);
                return;
            }
            _log.AppendText(string.Format("[{0:HH:mm:ss}] {1}{2}", DateTime.Now, message, Environment.NewLine));
            _log.SelectionStart = _log.TextLength;
            _log.ScrollToCaret();
        }

        private void OnDragEnter(object sender, DragEventArgs e)
        {
            if (e.Data.GetDataPresent(DataFormats.FileDrop)) e.Effect = DragDropEffects.Copy;
        }

        private void OnDragDrop(object sender, DragEventArgs e)
        {
            string[] files = e.Data.GetData(DataFormats.FileDrop) as string[];
            if (files == null) return;
            foreach (string file in files)
            {
                if (string.Equals(Path.GetExtension(file), ".md", StringComparison.OrdinalIgnoreCase))
                {
                    _markdownPath.Text = file;
                    Log("已拖入任务：" + file);
                    break;
                }
            }
        }

        private void OnFormClosing(object sender, FormClosingEventArgs e)
        {
            if (!_running) return;
            DialogResult result = MessageBox.Show(this, "Agent 仍在执行。要停止并关闭验证器吗？", "确认关闭", MessageBoxButtons.YesNo, MessageBoxIcon.Warning);
            if (result == DialogResult.No)
            {
                e.Cancel = true;
                return;
            }
            _cancelRequested = true;
            _pauseGate.Set();
        }
    }
}
