# 通用软件操作录制与 Mock 脚本生成器

这是 Windows 11 第一版原型。它不依赖 AutoCAD 或其他被录制软件的专用接口，也没有内置“画齿轮”流程。

系统分成两部分：

1. Windows 录制器捕获系统级鼠标、键盘、前台窗口、通用控件信息和关键截图。
2. 分析器通过 OpenAI Responses API 清洗无意义操作，生成语义轨迹、Mock TypeScript 描述和可直接运行的 Windows 回放脚本。

仓库还包含一个完全独立的 `Computer Use Validator`。它不读取录制器目录，只接收用户选择的
任务 MD，并通过 OpenAI Computer Use 控制用户明确选中的 Windows 窗口。可先用真实 AutoCAD
验证录制流程，未来也可以把目标窗口换成 Mock 软件。

## 当前能力

- 全局鼠标移动、左右键、中键、滚轮记录
- 拖拽轨迹采样
- 全局键盘和组合键记录
- Windows UI Automation 控件名称、类型、ID和边界读取
- 前台窗口及窗口相对坐标记录
- 点击和关键按键截图
- 每个画布操作的前后截图、变化像素比例和变化区域
- 密码控件输入自动脱敏
- `Ctrl+Shift+F12` 暂停或恢复隐私输入采集
- 单击、双击、右键、拖拽、滚动和连续文本初步分段
- GPT 清洗无效操作并生成目标导向的 Mock 脚本
- 自动生成可双击运行的 Windows 键鼠回放脚本，在真实 CAD 或其他目标软件中复现必要步骤
- 回放时重新识别当前画布，并把录制坐标转换为画布归一化坐标
- 输出画布对象变化、几何测量提示和完整拖拽轨迹
- 生成可直接交给 Computer Use Agent 的复现任务说明
- 直接使用 OpenAI 官方 Responses API
- 长流程自动分段，截图按整个分段均匀抽样并与事件文件名关联
- API 上传前自动把关键截图压缩为临时副本；本地原始截图保持不变
- 上传连接临时中断、超时或服务端繁忙时自动有限重试
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
- `maxImageWidth` / `maxImageHeight`：仅用于 API 临时副本的最大尺寸
- `jpegQuality`：API 临时 JPEG 副本质量；不会修改录制原图
- `minimumConfidence`：标记低置信度步骤的阈值

把 OpenAI API 密钥填写到项目根目录的 `.env` 文件：

```dotenv
OPENAI_API_KEY=sk-你的密钥
```

程序运行时会自动读取它。`.env` 已加入 `.gitignore`，不要把该文件发送给别人。
OpenAI 请求使用 `store: false`，但录制文件和截图仍会保存在本机，请在使用后按内部数据规范处理。

## 生成脚本

```powershell
powershell -ExecutionPolicy Bypass -File scripts\analyze-recording.ps1 `
  -Recording "bin\recorder\recordings\20260820-120000" `
  -Config "config.json"
```

输出：

```text
generated\semantic-trace.json
generated\analysis-input-manifest.json
generated\mock-script.ts
generated\computer-use-task.md
generated\autocad-replay.scr
```

要在真实 CAD 中回放：

1. 打开 CAD，并准备一份空白、可丢弃的测试图纸。
2. 在 AutoCAD 命令行输入 `SCRIPT` 并按 Enter。
3. 选择 `generated\autocad-replay.scr`。
4. AutoCAD 将按 SCR 中的命令和业务坐标执行录制后的有效流程。

SCR 会把工具栏动作转换为等价的 AutoCAD 命令，并省略误输入和被撤销的动作。只有在键盘事件或截图中能确认业务坐标、半径等关键数值时才会生成，像素距离不会冒充 CAD 单位。请只在空白、可丢弃的测试图纸中运行。

`mock-script.ts` 不复制真实软件的绝对坐标。它要求 Mock Runtime 按以下顺序寻找等价按钮：

```text
语义功能 → 无障碍信息 → 按钮文字 → 视觉识别 → 相对位置兜底
```

每一步执行后都需要验证界面状态；选错按钮时应退出、撤销并尝试下一个候选。

`computer-use-task.md` 可直接作为 Computer Use Agent 的任务说明。实际执行前仍需提供
可启动且可重置的目标 Mock 软件；Agent 会按每步 `canvasChange`、参考截图、拖拽轨迹和
几何 measurements 验证操作结果。

## Computer Use Validator

构建独立验证器：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build-validator.ps1
```

生成文件：

```text
bin\validator\ComputerUseValidator.exe
```

使用步骤：

1. 打开 AutoCAD，新建一张可丢弃的空白测试图纸，并把窗口最大化。
2. 启动 `ComputerUseValidator.exe`。
3. 拖入或选择一个 `computer-use-task.md`。
4. 在“目标窗口”中选择 AutoCAD；找不到时点击“刷新窗口”。
5. 确认 API Key 和模型。程序会自动尝试读取 `OPENAI_API_KEY` 环境变量或上级目录的 `.env`。
6. 点击“开始执行”，确认本次 MD 和目标窗口截图可以上传。
7. 随时可以暂停、停止，或按 `Ctrl+Shift+F11` 全局紧急停止。

验证器只把 Computer Use 坐标映射到所选窗口内，越界动作会被阻止。默认不会保存、另存、
覆盖或关闭 CAD 文件。每次运行的任务副本、窗口截图、API 原始响应、实际动作和最终报告保存在：

```text
文档\ComputerUseValidator\runs\日期-时间\
```

验证器不会把 MD 引用的多张参考图直接放进 Computer Use 请求。Computer Use 每轮只接收当前
目标窗口的一张截图，MD 中的目标、步骤和验证标准作为文字任务发送。因此日常操作只需要选择
一个 MD 文件；若 MD 引用的图片不在本机，也不会阻止执行。

临时网络连接错误、请求超时、HTTP 408/409/429 和服务端 5xx 错误会自动重试 2 次并采用短暂
指数退避。每次请求最长等待 10 分钟；验证器使用独立 HTTPS 连接，避免旧版 Windows .NET
长连接复用导致的 TLS 接收失败。

OpenAI Computer Use 返回的是需要由本地程序执行的界面动作；验证器按照官方循环依次执行
一批动作、捕获更新后的目标窗口，再把新截图回传。请只在隔离测试环境和非敏感文件中使用。

验证器本地测试（不会调用 OpenAI API，也不会执行鼠标键盘动作）：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\test-validator.ps1
```

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
