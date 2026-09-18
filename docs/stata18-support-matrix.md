# Stata 18 最小闭环：有界真实录制与原生回放通过

状态：旧 VM 已实际观察为 Stata/MP 18.0、英文，初始数据集为 0 变量/0 观察值。已扫描主窗口、File/Data 菜单、空白 Data Editor、Statistics 首层及汇总/线性模型子菜单、summarize 和 regress 初始参数页，以及 Window > New Do-file Editor、空白编辑器外壳、File 一级/Open 子菜单、打开文件对话框和 Tools 菜单，分成 7 个分区、259 个控件。`live-observation.json` 保留一次性区域与操作记录；静态地图不含固定回放坐标。这仍是**部分 UI Map**，不能代表 Stata 全部控件或命令已测试。Tools 的七个项目在空白编辑器中均禁用，尚未执行；工具栏功能及其余未展开子菜单仍待扫描。本次通过主窗口 File > Do 原生调用生成的 `.do`；Do-file Editor 的 Tools 执行路径仍未测试。接口目录的 `documented_not_live_verified` 表示目录条目未逐项实机核验，不否定下述特定样本的原生运行。

用户随后明确允许首次启动，录制器已在旧 VM 成功启动。首段真实采集从空白 Data Editor 开始，逐格输入 `var1=[2,5,9,12]`、`var2=[4,8,13,19]`；实机网格和变量属性已确认两列、四行及两列均为 `float`。录制器停止前显示 32 条事件，停止后确认录制保存成功（VM 时钟为 2026-09-18）。这是**仅数据输入阶段的采集检查点**，不是完整统计分析闭环，也尚未逐张审计保存的截图。原始录制保留在 VM，未付费上传。录制时最大化 Data Editor 遮住了含许可证标识的 Results 启动文字；收到用户单独确认后，在停止录制状态下已清空旧实例的 Results 显示，核对数据仍为两列四行。随后通过 File > Save as 把这些数据保存为 VM Documents 中的新文件 `Stata18-data-entry-checkpoint-20260918-0243.dta`，Results 明确报告保存成功，再正常关闭旧实例，没有执行数据清空或文件覆盖。

为重新取得连续空白起始样本，已打开独立的第二个 Stata/MP 18.0 实例，界面确认 History 为空、default 数据集为 0 变量/0 观察值。没有使用新 frame：当前分析契约明确不支持多 frames，不能只因活动 frame 为空就忽略后台数据。录制器的实例绑定也要求同一 Windows 会话内恰有一个可见目标进程，因此先保存并关闭旧实例，不能随意选第一个 PID。新实例再次显示的启动许可证文字尚未清空，已单独请求确认；录制仍停止。后续不能把停止后的独立录制擅自拼成一个连续空白起始样本，仍须满足原始证据和完整流程验收要求。

## 2026-09-18 更新（覆盖上述待授权状态）

用户已单独确认清空新实例的 Results 启动显示，并在开始录制前完成。连续样本 `20260918-034557-105f30` 已完成：空白 default 数据 → GUI 输入 `var1=[3,6,10,14]`、`var2=[5,10,14,22]`（均 float）→ 标准 summarize → `regress var2 var1` → 保存新文件 → 重开 → Browse 核对所有数值和类型。独立源真值留在本地，未作为模型输入。录制为 89 条事件、120 张原图，内容去重为 95 张、9 段，零事件排除。

实机文件元数据是 `521.18.0.120`，界面版本是 18.0。已修复严格且保留来源的版本归一化，冲突字段、其他版本/版别仍拒绝。获授权后，本样本 9/9 分段完成真实模型分析，受控编译生成单文件 `.do`，未手改响应、录制或脚本。原样脚本已在旧 VM 的隔离空白 Stata/MP 18 实例通过 File > Do 执行：保存、重开、变量类型与逐格数值断言通过，GUI 结果中的 summarize/regress 与预先独立记录的源真值一致。本结论仅适用于该两列 float、四行、默认选项的连续样本；39 项相关离线测试通过，不推及其他 Stata 流程。13 次付费尝试中 12 次有响应、1 次服务过载的用量未知；已报告总计 input 472,539（其中 cached 63,098）、output 7,386、total 479,925 token，不估美元价格。配置别名 `gpt-5.6`，响应报告模型 `gpt-5.6-sol`。跨轮修复涵盖 epoch 时间戳、固定对象绑定、空白观察证据重叠、未观察单元格的 `null` 状态及 save 后的 `savedDataset` 生命周期；旧结果仅经严格原请求/证据复核后复用。详见 [本次验证记录](stata18-real-recording-verification-2026-09-18.md)。

## 范围与来源

| 模型选择的接口/角色 | 首轮允许参数与身份 | 官方依据 | 已编码/离线/原生/真实录制 |
| --- | --- | --- | --- |
| `blank` / session | 模型选择本地前置守卫（不是 Stata 原生命令）；必须有空白前置画面证据；运行时 `c(k)==0` 且 `c(N)==0`，否则退出，不清空现有数据 | [P] creturn（[Stata 18 编程手册](https://www.stata.com/manuals18/p.pdf)）；[D] clear（[数据管理手册](https://www.stata.com/manuals18/d.pdf)） | 是/是/本样本通过/本样本通过 |
| `input` / dataset → variable | 2–8 个不重复 ASCII 数值变量名；按可读证据保留 `byte/int/long/float/double`，不得默认 double；稳定语义 ID | [D] input（[Stata 18 数据管理手册，第 601 页](https://www.stata.com/manuals18/d.pdf)） | 是/是/本样本 float 通过/本样本 float 通过 |
| `input` / variable → cell | 每列 3–50 行；明确行列、有限数字、exact、事件来源；空洞/重复写拒绝 | 同上；该命令用于单文件数据内嵌，不声称逐次 Data Editor 输入与脚本调用相同 | 是/是/本样本通过/本样本通过 |
| `summarize` / dataset | 明确选择的现有数值变量列表，无选项、子集、权重 | [R] summarize（[Stata 18 手册](https://www.stata.com/manuals18/rsummarize.pdf)） | 是/是/本样本通过/本样本通过 |
| `regress` / dataset | 一个 Y、一个不同的 X，至少 3 个完整样本；X 按实际存储舍入后仍非常数；无选项、子集、权重 | [R] regress（[Stata 18 基本参考手册](https://www.stata.com/manuals18/r.pdf)） | 是/是/本样本通过/本样本通过 |
| `save` / dataset | 固定 `isolated-dta` 绑定；单文件脚本在目标 Stata 当前工作目录下新建 UUID 命名的隔离目录，保存相对路径 `reconstructed.dta`，不用 `replace`；目录已存在即停止 | [D] mkdir、save（[Stata 18 数据管理手册](https://www.stata.com/manuals18/d.pdf)）；[P] `confirm new file`（[Stata 18 编程手册](https://www.stata.com/manuals18/p.pdf)） | 是/是/本样本通过/本样本通过 |
| `use` / savedDataset | 仅重开刚保存的文件；断言行列、变量存储类型与每个数值；float 按原生 float() 舍入比对 | [D] use（[Stata 18 数据管理手册](https://www.stata.com/manuals18/d.pdf)） | 是/是/本样本通过/本样本通过 |

模型须给出每个操作的 `apiCall.interfaceId/command`、接收对象、具体参数与结果绑定；本地要求其与操作字段一致，不自行猜测或补选接口。内部 JSON 由 `src/analyzer/lib/stata-program.mjs` 校验，`src/analyzer/lib/stata-renderer.mjs` 确定性生成一个 `.do` 文件。

`stata-cli.mjs --plan <JSON> --output-root <现存目录>` 是纯离线计划编译。录制链路另用 `--recording <目录> --config <JSON> --prepare-only` 先只读准备报告和实际图像清单；检查后显式 `--analyze` 才会调用当前配置的模型（每轮最多 2 次、每段最多 12 张图、6000 输出 token，客户端自动网络重试 0 次）。失败或不确定的请求必须显式 `--retry-failed`；旧响应可用 `--compile-saved-run <既有分析目录>` 零 API 重编译，仍逐段核对原响应、请求、图像哈希、知识和证据。每次尝试保存请求、精确图像哈希/字节/标签、原始响应或错误、解析结果、usage 和状态。未返回 usage 的失败不当成零费用。

分析机上的 `primaryOutput`、`runDirectory`、`outputDirectory` 仅是 `.do` 与审计文件的本地保存位置，不会嵌入原生脚本。返回的 `runtimeOutputDirectory` 和 `runtimeDataFile` 则是相对于**执行时 Stata 当前工作目录**的目标机路径；脚本先检查活动数据集为空，再执行 `mkdir`，目录已存在或当前工作目录不可写时停止，不复用旧目录、不清空或覆盖文件。移动单个 `.do` 到另一台 Windows 机器无需改写用户目录；执行前应在 Stata 中确认当前工作目录适合写入并有足够空间。每次离线重编译生成新的目标目录名，旧结果不覆盖。

证据准备只接受同 Windows 会话的 `applicationProfile=stata`、`applicationEdition=MP`、可核验的 `18.0[.构建号]` 或一致的 Windows `521.18.0.*` 元数据、`language=en-US`、目标进程 `StataMP-64[.exe]`；其他版别/未知进程拒绝或排除。官方 [Stata 18 Windows 手册 B.2](https://www.stata.com/manuals18/gsw.pdf)列出 MP/SE/BE 进程分别为 `StataMP-64.exe`、`StataSE-64.exe`、`StataBE-64.exe`；当前分析只验收已观察的 MP，不把 SE/BE 或 `Stata-64.exe` 当作此 VM 事实。帧保存原始路径、时间、角色与同内容去重映射；晚于下个输入的帧标警告。调用前复核原图哈希并在本地 run 目录冻结本次上传副本，客户端读取该副本；指针按 down/move/up 不拆，单事务超预算直接停。本次除合成/fake-client 测试外，已对上述单个真实样本完成授权的模型分析。

建议安全样本：新空白数据，`dose=[1,2,3,4]`、`response=[3,5,8,9]`，分别 `summarize dose response`、`regress response dose`、另存和重开。变体更名并改为 `dose=[2,5,8]`、`response=[11,17,23]`；反例为不可读的粘贴内容、未知/已有初始数据、缺行、误认 Y/X、任意命令或保存覆盖。样本值仅是合成测试夹具，绝非某次录制的推断。

## 风险与待接入

- `.dta` 持久保存数值数据，不自动保存 Results 窗口里的 `summarize` 或 `regress` 输出；单文件 `.do` 重运行这些分析。本样本的统计量与独立原录制真值、保存重开读回和脚本断言已实机核验；其他数据和错误/退出分支尚未普遍验证。
- 当前只允许“先完成数据、后分析、再保存重开”的顺序。分析后再改数值、多个数据集/frames、缺失值、字符串、公式、导入、图、复杂回归、显式 `clear`、打开外部文件及覆盖已有文件均拒绝；不把用户已有数据变成空白数据。
- 尚需验证 Do-file Editor 的 Tools 执行路径和工具栏功能、扫描其余子菜单及非 Main/Model 参数页。主窗口 File > Do 已用于本样本实际执行；不能将它等同于编辑器 Tools 路径测试。完整未扫描范围见 `ui-index.json`。Data Editor 粘贴按键不包含文本，截图或受授权的其他证据看不到数值时必须留 `unknown/unresolved`。
- 分段证据准备、请求预算、模型返回接口校验、检查点和严格的跨版本旧响应复用已编码并离线测试；本样本另外完成真实录制、模型分析、原生执行和独立源真值对照。单样本通过不等于真实模型在其他录制上的命中率已经测定。
- 执行 `.do` 前应检查当前 Stata 内存的所有 frames/用户项目与敏感状态、确认当前工作目录适合创建新隔离目录，并在授权的隔离进程或空白场景中运行。脚本本身只检查当前活动数据集 `c(k)/c(N)`；不能替代对其他 frame 或当前工作会话的人工隔离。本样本正向 `mkdir`、`confirm new file` 和保存重开已原生通过；目录冲突、不可写目录等错误分支仍未实机测试。

## 开发包

`node scripts/package-stata-recorder.mjs` 在 `dist/stata-vm-*` 创建白名单包：编译好的 `StataRecorder.exe`、PowerShell 分析包装入口、Stata 分析器及其本地依赖闭包、按 `ui-index.json` 严格路径校验的部分实机地图、去敏后的观察/核对记录、本说明，以及从公开示例生成的无密钥 `config.json`。不遍历仓库，也不复制 `.env`、用户 `config.json`、录制、截图、请求体或数据集。包不带 Node 可执行文件；录制可单独运行，分析需另有 Node.js 20+。生成包不等于已在 VM 安装、录制、上传或验证。
