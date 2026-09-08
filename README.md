# 通用软件操作录制与 Mock 脚本生成器

这是 Windows 11 第一版原型。它不依赖 AutoCAD 或其他被录制软件的专用接口，也没有内置“画齿轮”流程。

系统分成两部分：

1. Windows 录制器捕获系统级鼠标、键盘、前台窗口、通用控件信息和关键截图。
2. 分析器通过 OpenAI Responses API 清洗无意义操作，生成语义轨迹、结构化 CAD 操作和 Mock TypeScript 描述；SCR 只是结构化结果的一个验证后端。

仓库还包含一个完全独立的 `Computer Use Validator`。它不读取录制器目录，只接收用户选择的
任务 MD，并通过 OpenAI Computer Use 控制用户明确选中的 Windows 窗口。可先用真实 AutoCAD
验证录制流程，未来也可以把目标窗口换成 Mock 软件。

## 当前能力

- 全局鼠标移动、左右键、中键、滚轮记录
- 拖拽轨迹采样
- 全局键盘和组合键记录
- Windows UI Automation 控件名称、类型、ID、边界和最多 8 层命名祖先读取
- 前台窗口及窗口相对坐标记录
- 点击和关键按键截图
- 每个画布操作的前后截图、变化像素比例和变化区域
- OFFSET、TRIM、EXTEND 等修改命令额外记录“操作前—选择/预览中—稳定后”三态截图
- 对本地检测到变化的操作成对上传前后截图，供 AI 配准判断 OFFSET 方向和 TRIM 删除区段
- 连续修改会把前一次“稳定后”画面作为持久状态基线；若当前稳定结果与基线相同，悬停预览、捕捉标记和显卡重绘残影会作为无最终贡献输入省略
- 可选启用 AutoCAD Action Recorder；停止后自动收集 ACTMX，并以有界顺序摘录辅助 AI 确认命令、输入和选择阶段
- 密码控件输入自动脱敏
- `Ctrl+Shift+F12` 暂停或恢复隐私输入采集
- 单击、双击、右键、拖拽、滚动和连续文本初步分段
- GPT 清洗无效操作并生成目标导向的 Mock 脚本
- AutoCAD 录制按每个操作分段检索本地 UI/命令知识库，不会整库上传
- 使用 Tab → Panel → Control → Split Part/Menu Item 层级帮助识别按钮
- PGP 缩写仅用于识别，结构化 CAD 操作保存知识库校验过的规范英文命令
- AI 不直接拼写 SCR；本地编译器从同一份 CAD 操作生成 AutoCAD 验证脚本
- 输出画布对象变化、几何测量提示和完整拖拽轨迹
- 生成可直接交给 Computer Use Agent 的复现任务说明
- 直接使用 OpenAI 官方 Responses API
- 长流程自动分段，截图按整个分段均匀抽样并与事件文件名关联
- API 上传前自动把关键截图压缩为临时副本；本地原始截图保持不变
- 上传连接临时中断、超时或服务端繁忙时自动指数退避重试
- 每个成功分析分段都会保存检查点；连接失败后重新生成只从失败分段继续
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

运行后点击“开始录制”，完成目标软件操作，再点击“停止并保存”。默认会记录 Windows UI Automation 控件名称、Automation ID 和父级层次；若要测试仅依赖鼠标、键盘和截图的视觉识别准确度，可在开始前取消勾选“记录 UI Automation 控件信息”。如果当前录制的是 AutoCAD，且希望增加原生命令证据，可在开始前勾选“同时启用 AutoCAD Action Recorder”；其他软件不要勾选。录制目录位于：

```text
bin\recorder\recordings\日期-时间\
```

### 独立的 3ds Max 2027 录制器

3ds Max 使用单独的 UI Map、EXE 和录制目录，但复用同一套已经验证过的 Windows 输入采集引擎：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build-3dsmax-recorder.ps1
```

生成文件：

```text
bin\3dsmax-recorder\ThreeDsMaxRecorder.exe
```

它只保存 `3dsmax.exe` 的交互，录制目录位于 `bin\3dsmax-recorder\recordings\日期-时间\`；
manifest 会明确写入 `autodesk-3dsmax`、`ui-maps/3dsmax/2027/en-US` 和首选回放格式
`maxscript`。该版本不会启用 AutoCAD Action Recorder、AutoCAD 命令启发式或 CAD SCR 分析，
因此不会污染 AutoCAD 版本。停止录制后会调用独立的 3ds Max 分析器，先生成结构化场景操作，
再由本地编译器输出 MAXScript；AI 不直接自由编写脚本文本。

也可以分析已经存在的 3ds Max 录制：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\analyze-3dsmax-recording.ps1 `
  -Recording "bin\3dsmax-recorder\recordings\20260830-120000" `
  -Config "config.json"
```

核心输出为：

```text
generated\semantic-trace.json
generated\max-program.json
generated\3dsmax-replay.ms
```

`max-program.json` 使用稳定对象 ID 表达基础体创建、选择、移动/旋转/缩放、克隆、删除、
参数修改、添加修改器和转换 Editable Poly。参数必须来自键盘输入或清晰可见的带标签字段；
无法确定的三维数值不会按屏幕像素猜测。`3dsmax-replay.ms` 只编译本地后端支持且证据充分的操作。

## 配置 OpenAI API

首次使用且没有 `config.json` 时复制示例配置：

```powershell
if (-not (Test-Path config.json)) { Copy-Item config.example.json config.json }
```

配置文件中主要填写：

- `model`：要调用的 OpenAI 模型
- `timeoutSeconds`：单次分析的超时时间
- `maxRetries` / `retryBaseDelayMs`：临时断线或服务繁忙时的重试次数和指数退避起点
- `forceTls12OnIntegrityError`：遇到 TLS 记录完整性错误时，后续重试改用无会话缓存的 TLS 1.2 新连接
- `uploadChunkBytes`：请求体分块写入网络连接的大小；默认 65536，降低大请求经过代理或安全软件时的传输抖动
- `maxActionsPerRequest`：长流程每次发送的最大候选动作数
- `maxActionMacroEntriesPerRequest`：每个分段最多发送的 ACTMX JSON/XML 顺序条目数
- `maxValidationRepairs`：AI 结果未通过结构校验时，最多自动携带错误和原结果纠正的次数
- `maxScreenshotsPerRequest`：每个分段最多发送的截图数
- `finalCadVisualAudit`：分段合并后，再用录制结束画布和修改命令前后图审计最终 CAD 拓扑，补齐细线穿圆、TRIM 区段遗漏等跨分段问题
- `maxImageWidth` / `maxImageHeight`：仅用于 API 临时副本的最大尺寸
- `jpegQuality`：API 临时 JPEG 副本质量；不会修改录制原图
- `minimumConfidence`：标记低置信度步骤的阈值
- `autoCadKnowledge`：AutoCAD 知识库开关、目录和每段最多返回的控件/命令/菜单候选数
- `threeDsMax`：3ds Max 每段动作/截图数量、临时截图尺寸和校验修复次数
- `threeDsMaxKnowledge`：3ds Max UI Map 开关、目录和每段最多检索的菜单/工具栏候选数

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
generated\cad-program.json
generated\mock-script.ts
generated\autocad-replay.scr
```

默认只保留以上核心产物，避免每次录制产生大量中间文件。如需排查分析过程，可在
`config.json` 的 `output` 中设置 `"keepDiagnostics": true`，额外保留输入清单、Harness、
知识库使用记录、Computer Use 任务和 SCR 校验报告。

要在真实 CAD 中回放：

1. 打开 CAD，并准备一份空白、可丢弃的测试图纸。
2. 在 AutoCAD 命令行输入 `SCRIPT` 并按 Enter。
3. 选择 `generated\autocad-replay.scr`。
4. AutoCAD 将按 SCR 中的命令和业务坐标执行录制后的有效流程。

`cad-program.json` 是主要的 CAD 识别产物，保存命令、强类型参数、实体 ID、对象捕捉关系和录制证据。OFFSET/TRIM 还会保存 `visualInference`（使用的前后截图、变化区域、源/参考实体和方向）以及可严格确定时的 `resultGeometry`。前后截图只用于消除方向和拓扑歧义，CAD 尺寸仍必须来自明确输入、已知实体或解析几何，不能按像素猜测。它不绑定 SCR，可由 AutoCAD、Mock CAD 或其他执行器分别编译。AI 不直接输出 SCR 文本，也不会由 SCR 编译器偷偷修正识别坐标。

默认采用节省 API 的混合策略：仍使用 `gpt-5.6`，普通分段设置低推理强度和低输出冗长度；坐标输入、局部画布变化、TRIM/OFFSET 证据及最终画布保持高清，普通概览图使用低清。相邻 CAD 命令会尽量合并进同一请求，但 ARRAY 等需要先物化实体的边界仍会保留。可在 `config.json` 调整 `reasoningEffort`、`imageDetail`、`maxScreenshotsPerRequest` 和 `minActionsPerRequest`。

Enter 提交数值前的 AutoCAD 动态输入截图会优先以局部高分辨率上传，用于同时读取字段标签、距离、角度、坐标和对象捕捉。此前分段创建的实体会通过稳定实体目录继续传给后续分段，避免一个早期 LINE 被遗漏后造成 OFFSET、ROTATE、FILLET、TRIM 等操作整链丢失。

多阶段命令会保留操作级证据：例如 OFFSET 使用“选择源对象前”和“提交侧点后”的画面，而不是错误地要求最终变化出现在同一次点击中。分析器还会依据命令目录重新计算可能滞后的命令上下文，并拒绝引用没有由此前操作实际创建的“幽灵实体”。

关联 ARRAY 会一直分析到用户点击 `Close Array` 后才形成几何分段；阵列成员会在下一条 FILLET/TRIM 等修改命令开始前确定性展开。TRIM 产生的新圆弧或线段会替换原实体，后续分段只能引用仍存在的结果 ID。若旧分析遗漏了同一源圆的中间圆弧，但原始切割边、点击证据和最终交点均可严格确定，最终审计可把连续修剪规范化为一个 composite TRIM，一次表达最终全部保留圆弧，而不会创建幽灵实体。

`analysis-harness.json` 记录每个分段在调用 AI 前建立的命令状态、候选命令、当前命令的选项语法和逐项输入解释。它只向 AI 提供当前相关的少量语法，不会把完整命令手册全部塞进一次请求。例如在 ARRAY 已激活时，`I` 会被解释为 `Items` 选项，后续 `12` 才会被解释为 `item_count=12`；Enter 的含义取决于当前提示，Escape 会明确取消当前命令。跨分段未完成的命令通过 `commandState` 继续传递，避免把下一段的选项误认成新命令。

当某些操作缺少精确参数时，`cad-program.json` 会保留其余已经确认的 operations，并使用 `complete=false` 标记缺口；不会再因为一项不完整而清空整个 CAD 模型或把 Mock 脚本判为生成失败。

`autocad-replay.scr` 仅用于在真实 AutoCAD 中检查结构化操作是否能正确还原。分析结果即使标记为不完整，也会尽量根据已经确认的精确 `resultGeometry` 输出部分 SCR；缺失或不确定的操作不会被猜入脚本。像素距离不会冒充 CAD 单位。验证后端会根据稳定实体链和精确最终几何直接绘图，不再交互式重放 ROTATE、FILLET、TRIM 后用窗口猜选对象。请只在空白、可丢弃的测试图纸中运行。

启用 `keepDiagnostics` 后，`autocad-scr-validation.json` 会单独记录 SCR 后端是否成功、是否为部分结果。如果某个 CAD 操作暂时无法编译成 SCR，主分析仍然成功并保留 `cad-program.json`，不会为了迁就 SCR 而篡改 AI 的识别结果。

`knowledge-used.json` 记录每个分析分段实际提供给模型的控件、菜单和命令引用，以及最终 CAD
操作通过本地命令目录校验的结果。它不会复制完整知识库，也不会记录固定屏幕坐标。

启用 AutoCAD Action Recorder 后，录制根目录会增加 `action-recorder.json` 和
`action-recorder\*.actmx`。`analysis-input-manifest.json` 会记录每个 AI 请求是否附带了 Action
Macro 摘录及条目范围。新版 JSON ACTMX 会被解析为 CommandNode 及其输入子节点，距离、取点和命令提示不再被当成一整段文本截断。ACTMX 可提供精确的已记录 CAD 输入，但对象 ID 和最终拓扑仍必须由事件、前后截图和已有实体共同验证。

`mock-script.ts` 不复制真实软件的绝对坐标。它要求 Mock Runtime 按以下顺序寻找等价按钮：

```text
语义功能 → 无障碍信息 → 按钮文字 → 视觉识别 → 相对位置兜底
```

如果 Mock Runtime 支持 CAD 操作模型，应优先消费同一 workflow 中的 `cadProgram`；否则按 `steps` 查找界面按钮并执行。两种执行方式使用的是同一次 AI 识别结果。

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

## Quartus recorder

Quartus follows the visual recording → model API with UI Map → structured JSON → controlled Tcl → native project route. See [usage and supported scope](src/Recorder.Quartus/README.md) and [verification status](docs/quartus-recorder-status-2026-09-07.md).

Build with `npm run build:recorder:quartus`; run offline regressions with `npm run test:quartus`. Real recordings, API requests, credentials and screenshots remain local and are not included in this repository.
