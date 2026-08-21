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
            Application.Run(new RecorderForm());
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
        private readonly CheckBox _generateAfterStopCheckBox;
        private readonly Label _statusLabel;
        private readonly Label _pathLabel;
        private readonly System.Windows.Forms.Timer _timer;
        private RecorderEngine _engine;
        private string _currentRecordingDirectory;
        private bool _analysisRunning;

        public RecorderForm()
        {
            Text = "通用操作录制器 - Windows 11 原型";
            Width = 620;
            Height = 276;
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;

            var title = new Label
            {
                Text = "记录鼠标、键盘、窗口、通用控件和关键截图",
                Left = 24,
                Top = 22,
                Width = 550,
                Height = 28,
                Font = new Font(Font.FontFamily, 11, FontStyle.Bold)
            };

            _startButton = new Button { Text = "开始录制", Left = 24, Top = 66, Width = 130, Height = 38 };
            _stopButton = new Button { Text = "停止并生成", Left = 170, Top = 66, Width = 130, Height = 38, Enabled = false };
            _generateAfterStopCheckBox = new CheckBox
            {
                Text = "停止后自动调用 AI 生成 Mock 脚本（会上传录制事件和选取的关键截图）",
                Left = 24,
                Top = 112,
                Width = 560,
                Height = 24,
                Checked = true
            };
            _statusLabel = new Label { Text = "尚未开始", Left = 24, Top = 144, Width = 550, Height = 22 };
            _pathLabel = new Label { Text = "", Left = 24, Top = 172, Width = 550, Height = 42, AutoEllipsis = true };

            Controls.Add(title);
            Controls.Add(_startButton);
            Controls.Add(_stopButton);
            Controls.Add(_generateAfterStopCheckBox);
            Controls.Add(_statusLabel);
            Controls.Add(_pathLabel);

            _startButton.Click += StartRecording;
            _stopButton.Click += StopRecording;
            FormClosing += OnFormClosing;

            _timer = new System.Windows.Forms.Timer { Interval = 500 };
            _timer.Tick += delegate
            {
                if (_engine != null && _engine.IsRecording)
                {
                    _statusLabel.Text = "正在录制，已保存事件 " + _engine.EventCount + " 条。Ctrl+Shift+F12 可暂停隐私输入。";
                }
            };
            _timer.Start();
        }

        private void StartRecording(object sender, EventArgs e)
        {
            if (_analysisRunning) return;
            var baseDirectory = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "recordings");
            var outputDirectory = Path.Combine(baseDirectory, DateTime.Now.ToString("yyyyMMdd-HHmmss"));
            try
            {
                _currentRecordingDirectory = outputDirectory;
                _engine = new RecorderEngine(outputDirectory);
                _engine.Start();
                _startButton.Enabled = false;
                _stopButton.Enabled = true;
                _statusLabel.Text = "正在录制";
                _pathLabel.Text = "保存位置：" + outputDirectory;
                WindowState = FormWindowState.Minimized;
            }
            catch (Exception error)
            {
                if (_engine != null) _engine.Stop();
                _engine = null;
                MessageBox.Show(this, error.Message, "无法开始录制", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private void StopRecording(object sender, EventArgs e)
        {
            _statusLabel.Text = "正在保存剩余事件，请稍候……";
            _stopButton.Enabled = false;
            Refresh();
            if (_engine != null) _engine.Stop();
            WindowState = FormWindowState.Normal;
            Activate();

            var eventCount = _engine == null ? 0 : _engine.EventCount;
            if (_generateAfterStopCheckBox.Checked && !string.IsNullOrEmpty(_currentRecordingDirectory))
            {
                StartAnalysis(_currentRecordingDirectory, eventCount);
            }
            else
            {
                _startButton.Enabled = true;
                _statusLabel.Text = "录制完成，共保存事件 " + eventCount + " 条。";
            }
        }

        private void StartAnalysis(string recordingDirectory, long eventCount)
        {
            _analysisRunning = true;
            _startButton.Enabled = false;
            _stopButton.Enabled = false;
            _generateAfterStopCheckBox.Enabled = false;
            _statusLabel.Text = "录制完成（" + eventCount + " 条事件），正在调用 AI 生成 Mock 脚本……";
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
                        var generatedDirectory = Path.Combine(recordingDirectory, "generated");
                        if (errorMessage == null)
                        {
                            _statusLabel.Text = "生成完成，可以开始下一次录制。";
                            _pathLabel.Text = "Mock 脚本：" + Path.Combine(generatedDirectory, "mock-script.ts");
                            MessageBox.Show(
                                this,
                                "Mock 脚本已生成：\r\n" + generatedDirectory,
                                "生成完成",
                                MessageBoxButtons.OK,
                                MessageBoxIcon.Information);
                        }
                        else
                        {
                            _statusLabel.Text = "录制已保存，但 Mock 脚本生成失败。";
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

            var scriptPath = Path.Combine(workspaceDirectory.FullName, "scripts", "analyze-recording.ps1");
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
                RedirectStandardError = true
            };

            using (var process = Process.Start(startInfo))
            {
                if (process == null)
                    throw new InvalidOperationException("无法启动分析器。");
                var standardOutput = process.StandardOutput.ReadToEnd();
                var standardError = process.StandardError.ReadToEnd();
                process.WaitForExit();
                if (process.ExitCode != 0)
                {
                    var details = string.IsNullOrWhiteSpace(standardError) ? standardOutput : standardError;
                    throw new InvalidOperationException(
                        "分析器返回错误 " + process.ExitCode + "：\r\n" + TrimForDialog(details));
                }
            }

            var generatedScript = Path.Combine(recordingDirectory, "generated", "mock-script.ts");
            if (!File.Exists(generatedScript))
                throw new InvalidOperationException("分析器已结束，但没有找到生成的 mock-script.ts。");
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
        private Point _lastMovePoint;
        private volatile bool _privacyPaused;
        private volatile bool _recording;

        public RecorderEngine(string outputDirectory)
        {
            _outputDirectory = outputDirectory;
            _screenshotDirectory = Path.Combine(outputDirectory, "screenshots");
            _mouseProc = MouseHookCallback;
            _keyboardProc = KeyboardHookCallback;
        }

        public bool IsRecording { get { return _recording; } }
        public long EventCount { get { return Interlocked.Read(ref _eventCount); } }

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
            _recording = false;
            if (_mouseHook != IntPtr.Zero) UnhookWindowsHookEx(_mouseHook);
            if (_keyboardHook != IntPtr.Zero) UnhookWindowsHookEx(_keyboardHook);
            _mouseHook = IntPtr.Zero;
            _keyboardHook = IntPtr.Zero;
            if (!_queue.IsAddingCompleted) _queue.CompleteAdding();
            if (_worker != null && _worker.IsAlive) _worker.Join();
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
                        WheelDelta = message.ToInt32() == WmMouseWheel ? (short)((input.MouseData >> 16) & 0xffff) : 0
                    };
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
                    _privacyPaused = !_privacyPaused;
                    return CallNextHookEx(_keyboardHook, code, message, data);
                }

                if (!_privacyPaused)
                {
                    if (IsModifierKey(input.VirtualKeyCode))
                        return CallNextHookEx(_keyboardHook, code, message, data);

                    UiTarget focusedTarget;
                    bool isPassword;
                    ReadFocusedContext(out focusedTarget, out isPassword);
                    Enqueue(new RawInputEvent
                    {
                        Id = NextId(),
                        EventType = "key_down",
                        TimestampMs = UtcNowMs(),
                        Key = isPassword ? "REDACTED" : ((Keys)input.VirtualKeyCode).ToString().ToUpperInvariant(),
                        Text = isPassword ? null : TranslateKey(input.VirtualKeyCode, input.ScanCode),
                        Modifiers = modifiers.ToArray(),
                        Target = focusedTarget
                    });
                }
            }
            return CallNextHookEx(_keyboardHook, code, message, data);
        }

        private void Enqueue(RawInputEvent input)
        {
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
                    input.Window = ReadForegroundWindow();
                    if (input.Window != null && input.Window.ProcessId == Process.GetCurrentProcess().Id) continue;

                    if (input.EventType.StartsWith("mouse_"))
                    {
                        input.Target = ReadTargetAt(input.X, input.Y);
                        if (input.Window != null && input.Window.Width > 0 && input.Window.Height > 0)
                        {
                            input.RelativeX = Math.Round((double)(input.X - input.Window.X) / input.Window.Width, 6);
                            input.RelativeY = Math.Round((double)(input.Y - input.Window.Y) / input.Window.Height, 6);
                        }
                    }
                    if (input.Snapshot != null)
                    {
                        input.Screenshot = SaveScreenshot(input.Id, input.Snapshot);
                        input.ScreenshotTimestampMs = input.SnapshotTimestampMs;
                    }
                    else if (ShouldCaptureScreenshot(input))
                    {
                        Thread.Sleep(120);
                        input.Screenshot = CaptureScreenshot(input.Id);
                        input.ScreenshotTimestampMs = UtcNowMs();
                    }

                    WriteEvent(input);
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
                "  \"version\": \"0.1\",\n" +
                "  \"platform\": \"windows\",\n" +
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
            bitmap.Save(Path.Combine(_outputDirectory, relativePath), ImageFormat.Jpeg);
            return relativePath.Replace('\\', '/');
        }

        private static bool ShouldCaptureScreenshot(RawInputEvent input)
        {
            return input.EventType == "mouse_down" || input.EventType == "mouse_up" ||
                   (input.EventType == "key_down" && (input.Key == "ENTER" || input.Key == "ESCAPE"));
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
                Height = (int)rectangle.Height
            };
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

        private static WindowInfo ReadForegroundWindow()
        {
            var handle = GetForegroundWindow();
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
            [DataMember(Name = "error", EmitDefaultValue = false)] public string Error;
            public Bitmap Snapshot;
            public long SnapshotTimestampMs;
        }

        [DataContract]
        private sealed class WindowInfo
        {
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
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr window, StringBuilder text, int count);
        [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr window, out Rect rectangle);
        [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
        [DllImport("user32.dll")] private static extern short GetKeyState(int virtualKey);
        [DllImport("user32.dll")] private static extern bool GetKeyboardState(byte[] state);
        [DllImport("user32.dll")] private static extern IntPtr GetKeyboardLayout(uint threadId);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int ToUnicodeEx(uint virtualKey, uint scanCode, byte[] state, StringBuilder buffer, int capacity, uint flags, IntPtr layout);
    }
}
