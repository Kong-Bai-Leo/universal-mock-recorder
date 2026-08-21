using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace ComputerUseValidator
{
    internal sealed class WindowTarget
    {
        public IntPtr Handle { get; private set; }
        public string Title { get; private set; }
        public string ProcessName { get; private set; }

        public WindowTarget(IntPtr handle, string title, string processName)
        {
            Handle = handle;
            Title = title;
            ProcessName = processName;
        }

        public override string ToString()
        {
            return string.Format("{0}  [{1}]", Title, ProcessName);
        }
    }

    internal static class NativeDesktop
    {
        private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

        [StructLayout(LayoutKind.Sequential)]
        private struct RECT
        {
            public int Left;
            public int Top;
            public int Right;
            public int Bottom;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct INPUT
        {
            public uint type;
            public InputUnion U;
        }

        [StructLayout(LayoutKind.Explicit)]
        private struct InputUnion
        {
            [FieldOffset(0)] public MOUSEINPUT mi;
            [FieldOffset(0)] public KEYBDINPUT ki;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct MOUSEINPUT
        {
            public int dx;
            public int dy;
            public uint mouseData;
            public uint dwFlags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct KEYBDINPUT
        {
            public ushort wVk;
            public ushort wScan;
            public uint dwFlags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        [DllImport("user32.dll")]
        private static extern bool SetProcessDPIAware();

        [DllImport("user32.dll")]
        private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);

        [DllImport("user32.dll")]
        private static extern bool IsWindowVisible(IntPtr hWnd);

        [DllImport("user32.dll")]
        internal static extern bool IsWindow(IntPtr hWnd);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);

        [DllImport("user32.dll")]
        private static extern int GetWindowTextLength(IntPtr hWnd);

        [DllImport("user32.dll")]
        private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

        [DllImport("user32.dll")]
        private static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);

        [DllImport("user32.dll")]
        private static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        private static extern bool ShowWindow(IntPtr hWnd, int command);

        [DllImport("user32.dll")]
        private static extern bool IsIconic(IntPtr hWnd);

        [DllImport("user32.dll")]
        private static extern bool SetCursorPos(int x, int y);

        [DllImport("user32.dll")]
        private static extern void mouse_event(uint flags, uint dx, uint dy, int data, UIntPtr extraInfo);

        [DllImport("user32.dll")]
        private static extern void keybd_event(byte virtualKey, byte scanCode, uint flags, UIntPtr extraInfo);

        [DllImport("user32.dll")]
        private static extern short VkKeyScan(char character);

        [DllImport("user32.dll")]
        private static extern uint SendInput(uint count, INPUT[] inputs, int size);

        private const int SW_RESTORE = 9;
        private const uint INPUT_KEYBOARD = 1;
        private const uint KEYEVENTF_KEYUP = 0x0002;
        private const uint KEYEVENTF_UNICODE = 0x0004;
        private const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
        private const uint MOUSEEVENTF_LEFTUP = 0x0004;
        private const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
        private const uint MOUSEEVENTF_RIGHTUP = 0x0010;
        private const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
        private const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
        private const uint MOUSEEVENTF_WHEEL = 0x0800;
        private const uint MOUSEEVENTF_HWHEEL = 0x01000;

        internal static void EnableDpiAwareness()
        {
            try { SetProcessDPIAware(); }
            catch { }
        }

        internal static List<WindowTarget> ListWindows(IntPtr excludedHandle)
        {
            List<WindowTarget> results = new List<WindowTarget>();
            int ownProcessId = Process.GetCurrentProcess().Id;

            EnumWindows(delegate(IntPtr handle, IntPtr unused)
            {
                if (handle == excludedHandle || !IsWindowVisible(handle))
                {
                    return true;
                }

                int length = GetWindowTextLength(handle);
                if (length <= 0)
                {
                    return true;
                }

                RECT rect;
                if (!GetWindowRect(handle, out rect) || rect.Right - rect.Left < 300 || rect.Bottom - rect.Top < 180)
                {
                    return true;
                }

                StringBuilder titleBuilder = new StringBuilder(length + 1);
                GetWindowText(handle, titleBuilder, titleBuilder.Capacity);
                string title = titleBuilder.ToString().Trim();
                if (title.Length == 0)
                {
                    return true;
                }

                uint processId;
                GetWindowThreadProcessId(handle, out processId);
                if (processId == ownProcessId)
                {
                    return true;
                }

                string processName = "unknown";
                try { processName = Process.GetProcessById((int)processId).ProcessName; }
                catch { }

                results.Add(new WindowTarget(handle, title, processName));
                return true;
            }, IntPtr.Zero);

            results.Sort(delegate(WindowTarget left, WindowTarget right)
            {
                return string.Compare(left.Title, right.Title, StringComparison.CurrentCultureIgnoreCase);
            });
            return results;
        }

        internal static Rectangle GetBounds(WindowTarget target)
        {
            if (target == null || !IsWindow(target.Handle))
            {
                throw new InvalidOperationException("选择的目标窗口已经关闭。");
            }

            RECT rect;
            if (!GetWindowRect(target.Handle, out rect))
            {
                throw new InvalidOperationException("无法读取目标窗口位置。");
            }

            Rectangle bounds = Rectangle.FromLTRB(rect.Left, rect.Top, rect.Right, rect.Bottom);
            if (bounds.Width < 100 || bounds.Height < 100)
            {
                throw new InvalidOperationException("目标窗口尺寸太小，请先将其恢复或最大化。");
            }
            return bounds;
        }

        internal static void Activate(WindowTarget target)
        {
            if (target == null || !IsWindow(target.Handle))
            {
                throw new InvalidOperationException("选择的目标窗口已经关闭。");
            }
            if (IsIconic(target.Handle))
            {
                ShowWindow(target.Handle, SW_RESTORE);
            }
            SetForegroundWindow(target.Handle);
            Thread.Sleep(250);
        }

        internal static byte[] CapturePng(WindowTarget target)
        {
            Rectangle bounds = GetBounds(target);
            using (Bitmap bitmap = new Bitmap(bounds.Width, bounds.Height, PixelFormat.Format24bppRgb))
            {
                using (Graphics graphics = Graphics.FromImage(bitmap))
                {
                    graphics.CopyFromScreen(bounds.Left, bounds.Top, 0, 0, bounds.Size, CopyPixelOperation.SourceCopy);
                }
                using (MemoryStream stream = new MemoryStream())
                {
                    bitmap.Save(stream, ImageFormat.Png);
                    return stream.ToArray();
                }
            }
        }

        internal static Image ImageFromBytes(byte[] bytes)
        {
            using (MemoryStream stream = new MemoryStream(bytes))
            using (Image source = Image.FromStream(stream))
            {
                return new Bitmap(source);
            }
        }

        internal static void Execute(WindowTarget target, IDictionary<string, object> action)
        {
            string type = JsonValue.String(action, "type").ToLowerInvariant();
            Rectangle bounds = GetBounds(target);
            List<string> modifiers = JsonValue.StringList(action, "keys");

            if (type == "screenshot")
            {
                return;
            }
            if (type == "wait")
            {
                Thread.Sleep(2000);
                return;
            }
            if (type == "type")
            {
                TypeUnicode(JsonValue.String(action, "text"));
                return;
            }
            if (type == "keypress")
            {
                PressKeys(JsonValue.StringList(action, "keys"));
                return;
            }

            HoldModifiers(modifiers, true);
            try
            {
                if (type == "click" || type == "double_click" || type == "move" || type == "scroll")
                {
                    int localX = JsonValue.Int(action, "x");
                    int localY = JsonValue.Int(action, "y");
                    Point screen = ToScreen(bounds, localX, localY);
                    SetCursorPos(screen.X, screen.Y);

                    if (type == "move")
                    {
                        return;
                    }
                    if (type == "scroll")
                    {
                        int scrollY = JsonValue.Int(action, "scroll_y");
                        int scrollX = JsonValue.Int(action, "scroll_x");
                        if (scrollY != 0)
                        {
                            mouse_event(MOUSEEVENTF_WHEEL, 0, 0, -WheelDelta(scrollY), UIntPtr.Zero);
                        }
                        if (scrollX != 0)
                        {
                            mouse_event(MOUSEEVENTF_HWHEEL, 0, 0, WheelDelta(scrollX), UIntPtr.Zero);
                        }
                        return;
                    }

                    string button = JsonValue.String(action, "button");
                    if (string.IsNullOrEmpty(button)) button = "left";
                    MouseClick(button);
                    if (type == "double_click")
                    {
                        Thread.Sleep(100);
                        MouseClick(button);
                    }
                    return;
                }

                if (type == "drag")
                {
                    List<Point> points = JsonValue.PointList(action, "path");
                    if (points.Count < 2)
                    {
                        throw new InvalidOperationException("拖拽动作没有足够的路径点。");
                    }
                    Point start = ToScreen(bounds, points[0].X, points[0].Y);
                    SetCursorPos(start.X, start.Y);
                    mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, UIntPtr.Zero);
                    try
                    {
                        for (int i = 1; i < points.Count; i++)
                        {
                            Point next = ToScreen(bounds, points[i].X, points[i].Y);
                            SetCursorPos(next.X, next.Y);
                            Thread.Sleep(18);
                        }
                    }
                    finally
                    {
                        mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, UIntPtr.Zero);
                    }
                    return;
                }

                throw new NotSupportedException("不支持的 Computer Use 动作：" + type);
            }
            finally
            {
                HoldModifiers(modifiers, false);
            }
        }

        private static Point ToScreen(Rectangle bounds, int localX, int localY)
        {
            if (localX < 0 || localY < 0 || localX >= bounds.Width || localY >= bounds.Height)
            {
                throw new InvalidOperationException(string.Format(
                    "模型动作坐标 ({0},{1}) 超出目标窗口 {2}x{3}，已阻止执行。",
                    localX, localY, bounds.Width, bounds.Height));
            }
            return new Point(bounds.Left + localX, bounds.Top + localY);
        }

        private static int WheelDelta(int pixels)
        {
            int steps = Math.Max(1, (int)Math.Round(Math.Abs(pixels) / 100.0));
            return Math.Sign(pixels) * steps * 120;
        }

        private static void MouseClick(string button)
        {
            uint down;
            uint up;
            switch ((button ?? "left").ToLowerInvariant())
            {
                case "right": down = MOUSEEVENTF_RIGHTDOWN; up = MOUSEEVENTF_RIGHTUP; break;
                case "middle": case "wheel": down = MOUSEEVENTF_MIDDLEDOWN; up = MOUSEEVENTF_MIDDLEUP; break;
                case "left": down = MOUSEEVENTF_LEFTDOWN; up = MOUSEEVENTF_LEFTUP; break;
                default: throw new NotSupportedException("不支持的鼠标按钮：" + button);
            }
            mouse_event(down, 0, 0, 0, UIntPtr.Zero);
            Thread.Sleep(45);
            mouse_event(up, 0, 0, 0, UIntPtr.Zero);
        }

        private static void TypeUnicode(string text)
        {
            if (string.IsNullOrEmpty(text)) return;
            foreach (char character in text)
            {
                INPUT[] inputs = new INPUT[2];
                inputs[0].type = INPUT_KEYBOARD;
                inputs[0].U.ki.wScan = character;
                inputs[0].U.ki.dwFlags = KEYEVENTF_UNICODE;
                inputs[1].type = INPUT_KEYBOARD;
                inputs[1].U.ki.wScan = character;
                inputs[1].U.ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;
                SendInput(2, inputs, Marshal.SizeOf(typeof(INPUT)));
                Thread.Sleep(8);
            }
        }

        private static void PressKeys(List<string> keys)
        {
            if (keys.Count == 1 && keys[0].IndexOf('+') >= 0)
            {
                keys = new List<string>(keys[0].Split(new char[] { '+' }, StringSplitOptions.RemoveEmptyEntries));
            }

            List<byte> held = new List<byte>();
            try
            {
                foreach (string key in keys)
                {
                    byte vk = VirtualKey(key);
                    if (IsModifier(key))
                    {
                        keybd_event(vk, 0, 0, UIntPtr.Zero);
                        held.Add(vk);
                    }
                    else
                    {
                        keybd_event(vk, 0, 0, UIntPtr.Zero);
                        Thread.Sleep(35);
                        keybd_event(vk, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
                    }
                }
            }
            finally
            {
                for (int i = held.Count - 1; i >= 0; i--)
                {
                    keybd_event(held[i], 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
                }
            }
        }

        private static void HoldModifiers(List<string> keys, bool down)
        {
            if (keys == null) return;
            if (down)
            {
                foreach (string key in keys)
                {
                    if (IsModifier(key)) keybd_event(VirtualKey(key), 0, 0, UIntPtr.Zero);
                }
            }
            else
            {
                for (int i = keys.Count - 1; i >= 0; i--)
                {
                    if (IsModifier(keys[i])) keybd_event(VirtualKey(keys[i]), 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
                }
            }
        }

        private static bool IsModifier(string key)
        {
            string normalized = (key ?? string.Empty).Trim().ToUpperInvariant();
            return normalized == "CTRL" || normalized == "CONTROL" || normalized == "SHIFT" ||
                   normalized == "ALT" || normalized == "META" || normalized == "WIN" || normalized == "WINDOWS";
        }

        private static byte VirtualKey(string key)
        {
            string normalized = (key ?? string.Empty).Trim().ToUpperInvariant().Replace("_", string.Empty);
            switch (normalized)
            {
                case "CTRL": case "CONTROL": return 0x11;
                case "SHIFT": return 0x10;
                case "ALT": return 0x12;
                case "META": case "WIN": case "WINDOWS": return 0x5B;
                case "ENTER": case "RETURN": return 0x0D;
                case "TAB": return 0x09;
                case "ESC": case "ESCAPE": return 0x1B;
                case "BACKSPACE": return 0x08;
                case "DELETE": case "DEL": return 0x2E;
                case "SPACE": return 0x20;
                case "ARROWLEFT": case "LEFT": return 0x25;
                case "ARROWUP": case "UP": return 0x26;
                case "ARROWRIGHT": case "RIGHT": return 0x27;
                case "ARROWDOWN": case "DOWN": return 0x28;
                case "HOME": return 0x24;
                case "END": return 0x23;
                case "PAGEUP": return 0x21;
                case "PAGEDOWN": return 0x22;
                case "INSERT": return 0x2D;
            }
            if (normalized.Length > 1 && normalized[0] == 'F')
            {
                int functionNumber;
                if (int.TryParse(normalized.Substring(1), out functionNumber) && functionNumber >= 1 && functionNumber <= 24)
                {
                    return (byte)(0x70 + functionNumber - 1);
                }
            }
            if (normalized.Length == 1)
            {
                short mapped = VkKeyScan(normalized[0]);
                if (mapped != -1) return (byte)(mapped & 0xFF);
            }
            throw new NotSupportedException("不支持的按键：" + key);
        }
    }
}
