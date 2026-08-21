# 通用软件操作录制与 Mock 脚本生成器

这是 Windows 11 第一版原型。它不依赖 AutoCAD 或其他被录制软件的专用接口，也没有内置“画齿轮”流程。

系统分成两部分：

1. Windows 录制器捕获系统级鼠标、键盘、前台窗口、通用控件信息和关键截图。
2. 分析器通过 OpenAI Responses API 清洗无意义操作，生成语义轨迹和 Mock TypeScript 脚本。

## 当前能力

- 全局鼠标移动、左右键、中键、滚轮记录
- 拖拽轨迹采样
- 全局键盘和组合键记录
- Windows UI Automation 控件名称、类型、ID和边界读取
- 前台窗口及窗口相对坐标记录
- 点击和关键按键截图
- 密码控件输入自动脱敏
- `Ctrl+Shift+F12` 暂停或恢复隐私输入采集
- 单击、双击、右键、拖拽、滚动和连续文本初步分段
- GPT 清洗无效操作并生成目标导向的 Mock 脚本
- 直接使用 OpenAI 官方 Responses API
- 长流程自动分段，截图按整个分段均匀抽样并与事件文件名关联
- 使用严格 JSON Schema 和本地校验约束 Mock 工作流
- OpenAI 请求设置 `store: false`

## 构建录制器

在工作区打开 PowerShell：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build-recorder.ps1
```

生成文件：

```text
bin\recorder\UniversalMockRecorder.exe
```

运行后点击“开始录制”，完成目标软件操作，再点击“停止并保存”。录制目录位于：

```text
bin\recorder\recordings\日期-时间\
```

## 配置 OpenAI API

首次使用且没有 `config.json` 时复制示例配置：

```powershell
if (-not (Test-Path config.json)) { Copy-Item config.example.json config.json }
```

配置文件中主要填写：

- `model`：要调用的 OpenAI 模型
- `timeoutSeconds`：单次分析的超时时间
- `maxActionsPerRequest`：长流程每次发送的最大候选动作数
- `maxScreenshotsPerRequest`：每个分段最多发送的截图数
- `minimumConfidence`：标记低置信度步骤的阈值

把 OpenAI API 密钥填写到项目根目录的 `.env` 文件：

```dotenv
OPENAI_API_KEY=sk-你的密钥
```

程序运行时会自动读取它。`.env` 已加入 `.gitignore`，不要把该文件发送给别人。
OpenAI 请求使用 `store: false`，但录制文件和截图仍会保存在本机，请在使用后按内部数据规范处理。

## 生成 Mock 脚本

```powershell
powershell -ExecutionPolicy Bypass -File scripts\analyze-recording.ps1 `
  -Recording "bin\recorder\recordings\20260820-120000" `
  -Config "config.json"
```

输出：

```text
generated\semantic-trace.json
generated\mock-script.ts
```

`mock-script.ts` 不复制真实软件的绝对坐标。它要求 Mock Runtime 按以下顺序寻找等价按钮：

```text
语义功能 → 无障碍信息 → 按钮文字 → 视觉识别 → 相对位置兜底
```

每一步执行后都需要验证界面状态；选错按钮时应退出、撤销并尝试下一个候选。

## Mock 尚未确定时的边界

当前生成脚本遵循 [Mock Runtime 合约](src/mock-runtime/contract.ts)。同事确定 Mock 的技术栈后，需要实现这个合约，例如：

- 网页 Mock：可用浏览器自动化和截图视觉识别实现
- Windows 桌面 Mock：可用 UI Automation、截图和输入模拟实现
- Electron Mock：可组合 DOM定位与桌面视觉识别

Mock 的实现技术不会影响录制格式和 GPT 分析层。

## 隐私说明

录制内容可能包含屏幕文字和键盘输入。请只在测试环境使用，不要录制密码、个人聊天或敏感业务数据。密码输入框会尽量自动脱敏，但自绘密码控件可能无法被系统识别；遇到敏感输入时使用 `Ctrl+Shift+F12` 暂停采集。

## 开发测试

```powershell
node --test tests\*.test.mjs
```

正式产品还需要补充持续视频编码、安装包、可视化 GPT 设置页、录制回放预览和实际 Mock Runtime。
