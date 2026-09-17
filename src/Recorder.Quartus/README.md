# Quartus 操作录制器

面向 Quartus Prime Pro 26.1.1 英文界面的独立 Windows 录制器。
录制入口：`bin/quartus-recorder/QuartusRecorder.exe`。

流程：**截图与鼠标/键盘事件 → API 模型结合 UI Map 分析 → 结构化 JSON → 本地受控 Tcl 构建器 → Quartus 原生工程**。
录制不读取软件内部工程接口，不使用 UI Automation，也不探测密码框。AI 返回数据，由本地构建器决定能否生成工程；未知内容不能当作默认值补全。

采集、API 分析、原生工程执行分别验收。截至 2026-09-08，完整三端口与门录制已完成 7 段真实 API 分析，后续离线确认修复没有新增 API 请求。生成材料已在远程 Quartus 创建独立原生工程并完整编译，结果为 0 错误、13 警告，工程设置、源代码与编译报告核验 19/19 通过。该样本没有指定引脚/IO 标准，未生成烧录文件，未验证时序收敛或形式等价；不能推广为所有操作均能还原。验收明细在 `docs/quartus-recorder-status-2026-09-07.md`。

## 使用

1. 把完整工具包放在运行 Quartus 的电脑内，并在同一个 Windows 登录会话启动录制器。远程桌面情形下，应在**远程 Windows 内**启动；本机的 `mstsc.exe` 不属于 Quartus。
2. 点击“开始录制”，完成一个独立测试工程的操作，再点击“停止录制”。默认只保存本地，不上传、不调用模型。
3. 录制保存到程序旁的 `recordings/日期时间/`，包括 `manifest.json`、`events.jsonl` 和 `screenshots/`；窗口底部会显示路径。
4. 敏感输入前按 `Ctrl+Shift+F12` 暂停，再按一次恢复。截图覆盖整个虚拟桌面，输入的进程过滤不会遮挡其他窗口，录制时应保持专用桌面。
5. 需要模型分析时，把工具包根目录的 `config.example.json` 复制为 `config.json`，使用既有模型配置；密钥放在本机环境变量 `OPENAI_API_KEY` 或 `.env`。然后勾选停止后分析，或点击“重新生成”。选择分析会上传所选录制证据并产生 API 费用。

录制本身不需要 Node.js。分析需要 Node.js 20+；含运行时的工具包会优先使用 `runtime/node.exe`。订阅内的 Codex 用量与录制器 API 调用费用分开。

```powershell
# 本地准备证据，不调用模型、不构建工程
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/analyze-quartus-recording.ps1 -Recording '<录制目录>' -PrepareOnly

# 调用配置模型；输出默认保存在录制目录下的 generated
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/analyze-quartus-recording.ps1 -Recording '<录制目录>' -Config config.json
```

## 输入证据修复后的重新分析（历史操作说明）

以下说明记录输入证据修复时的重跑方式。当前完整样本已完成后续确认修复与远程还原；具备完整旧检查点时，可使用分析脚本的 `-ReprocessFrom` 参数进行严格校验后的离线重处理，无需再次调用 API。检查点来源目录和新输出目录必须独立，已有录制、输入与选图哈希必须一致。

本次更新针对观察事件被放入操作输入列表后校验失败的问题。请把新 ZIP **完整解压到新目录**，从新工具包根目录打开 PowerShell；保留原始录制和旧分析目录作为对照，不需要删除或重录已有证据。工具包包含 Node 运行时的版本会自动使用 `runtime/node.exe`。

先填写下面三个本机路径。`$quartusOutput` 使用新的分析目录；分析器会创建它。

```powershell
$quartusRecording = 'D:\你的录制目录'
$quartusConfig = 'D:\你的配置目录\config.json'
$quartusOutput = Join-Path $quartusRecording 'generated-input-evidence-fix'

# 只检查和准备本地录制证据，不调用 API、不操作 Quartus
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\analyze-quartus-recording.ps1 `
  -Recording $quartusRecording -Config $quartusConfig -Output $quartusOutput -PrepareOnly

# 确认后由你运行：调用现有配置中的模型，上传本次录制证据并产生 API 费用
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\analyze-quartus-recording.ps1 `
  -Recording $quartusRecording -Config $quartusConfig -Output $quartusOutput
```

使用已有的 `config.json` 和模型设置；密钥仍从本机环境变量、工具包根目录 `.env` 或配置文件旁的 `.env` 读取。分发包不附带这些私有文件，也不附带你的录制。没有已有配置时，再从 `config.example.json` 创建本机配置。

准备与正式分析使用同一份配置，才能保持分段与证据预算一致。此前完整创建样本共有 7 段；示例配置默认最多 4 次请求，可能需要在同一输出目录继续运行，校验修复也会消耗请求次数。程序不会自动提高你设置的上限。本机已有该样本的 `full-recording-analysis.config.json`（8 次请求上限）时可继续使用，不需要重新配置密钥；该本机配置不会加入分发包。

**本次代码、提示词和校验规则的变化会使旧检查点失效。** 旧版已通过的第 1 段不能直接沿用为修复版结果，重新分析将从第 1 段开始并产生新的 API 请求。原有检查点可保留，不要手改其标识或复制到新分析目录以强制跳过。此后同一版本、配置和证据未变时，在相同输出目录重跑才可以恢复已成功分段。

结束后先查看新目录的 `analysis-status.json`：分析成功仍可能显示 `build.status=blocked`，表示工程证据或支持范围尚不满足构建条件。只有生成 `project-bundle-*` 后，才继续下面的 JSON 构建步骤。分析入口不会自动执行 Quartus，也不会为使输出完整而补写未知 HDL、引脚或时序约束。

上述重跑说明本身不代表实际还原验证；当前样本的真实 API 分析、后续离线重处理和远程软件验收结果见验收明细。

## 输出与范围

`quartus-preparation.json` 表示证据准备；`quartus-workflow.json` 是经过本地校验的结构化数据；`analysis-status.json` 区分分析失败、分析成功但构建被阻止、以及构建文件已经生成。
允许构建时，输出下新增 `project-bundle-<唯一标记>/`，保存 HDL 源码、受控 `build.tcl`、工作流和 `build-report.json`。**这里只生成构建材料；执行 Tcl 后才创建 `.qpf`／`.qsf` 原生工程。** 默认分析不会自动运行 Quartus，也不会自动编译。

| 内容 | 当前构建支持 |
| --- | --- |
| 工程身份 | 有确切证据的名称、revision、顶层实体、器件系列与具体器件 |
| HDL 源文件 | 内容完整的 Verilog、SystemVerilog、VHDL；仅支持受限文件名与独立源文件 |
| 工程设置 | SEED、OPTIMIZATION_MODE、NUM_PARALLEL_PROCESSORS 的受支持值 |
| 引脚 | 对字面端口的 LOCATION、IO_STANDARD 分配 |
| 时钟 | 明确端口、名称和以 ns 表示的周期，生成基本 `create_clock` 约束 |
| 保存与编译 | Tcl 创建并重新打开工程、回读设置；命令行编译需显式选择 |

尚未支持 Platform Designer 系统/IP 构建、任意 IP 参数、外部 HDL 依赖和系统任务、完整 SDC、仿真平台重建、硬件烧录、任意已有工程修改。源码只有文件名而看不到内容、关键值是估计/未知、存在未解决操作时，会阻止构建。取消的操作可以被保留和解释，不会自动当作已应用工程设置。

分析成功、设置回读正确、编译成功和原录制还原正确是不同结论。编译通过不能证明时序收敛、逻辑等价或原设计已经完整恢复。

## 已有完整分析结果的离线重新生成

后续分段明确确认保存、提交或取消时，最终证据检查会关联该确认，保留早先操作的待定状态及原始图片记录。确认必须来自后续分段、同一进程、有效时间和实际选用的证据，不能用旧图或错误事件消除缺口。

若旧目录已保存全部分段，可使用新版工具重新校验并生成材料，无需重新调用 API：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/analyze-quartus-recording.ps1 -Recording '<原录制目录>' -Config '<原分析配置文件>' -ReprocessFrom '<完整旧分析目录>' -Output '<全新输出目录>'
```

此模式核对原输入、分段、截图内容及选择、知识准备和保存结果；不一致或分段不全时停止，不会回退到付费分析。旧结果保留，新目录记录来源哈希与 `mode=offline-reprocess`、`requests=0`。配置用于复现原分段和证据预算；省略时使用默认值，必须与原准备结果一致。不会启动 Quartus。

## 由 JSON 构建原生工程

从完整工具包根目录运行。`node` 可替换为工具包的 `runtime/node.exe`；每次提供新的输出目录，父目录需已存在。以下命令不会重新调用模型。

```powershell
# 生成构建材料，尚不启动 Quartus
node src/analyzer/quartus-build.mjs --workflow '<分析目录>/quartus-workflow.json' --output '<新的输出目录>'

# 在本机 Quartus 中实际创建工程并回读设置
node src/analyzer/quartus-build.mjs --workflow '<分析目录>/quartus-workflow.json' --output '<另一个新的输出目录>' --execute --quartus-sh '<quartus_sh.exe 的绝对路径>'

# 显式执行完整编译
node src/analyzer/quartus-build.mjs --workflow '<分析目录>/quartus-workflow.json' --output '<另一个新的输出目录>' --execute --quartus-sh '<quartus_sh.exe 的绝对路径>' --compile

# 生成供 Quartus 图形界面运行的构建材料
node src/analyzer/quartus-build.mjs --workflow '<分析目录>/quartus-workflow.json' --output '<另一个新的输出目录>' --target gui
```

GUI 执行使用 `--target gui` 生成的材料，运行前应无已打开工程。可以从 **Tools → Tcl Scripts** 选择新目录的 `build.tcl`，也可按以下已实机使用的入口执行：

1. 在 **File → Open** 中把文件类型改成 **Script Files**，打开新目录的 `build.tcl`。
2. 在脚本编辑器点击**蓝色羽毛带播放标记**的执行按钮。
3. 等待 Quartus 消息提示脚本执行结果，再检查新目录中的工程文件和 `quartus-readback.json`。

脚本重新打开工程时，Quartus 可能显示通用的 **trusted-source** 信任来源提示。先核对提示对应本次自己生成的新工程，再在前台处理。提示有时会被其他窗口遮挡；暂时看不到后续消息时应检查该提示，而不要反复执行脚本。不要为此关闭 Quartus 的信任提示设置。

GUI 与命令行材料有各自的运行保护，不能混用。GUI 不会自动编译；执行后的 `quartus-readback.json` 与 Quartus 消息是现场证据，生成时的 `build-report.json` 不会因为手工运行 GUI 而自动更新。

当前采集只接受已确认的 `quartus.exe`。独立 Platform Designer、外部编辑器和 `quartus_sh.exe` 等进程未纳入采集，不会因为窗口位于远程桌面内就自动计入。UI Map 中存在帮助条目不意味着该操作已具备录制或重建支持。
记录中的应用版本是适配目标版本，不是对正在运行的二进制版本的自动检测结果。

工具包包含 UI Map 的静态条目和证据元数据，不包含扫描原图、真实录制或开发者的密钥。元数据中的开发机原图路径用于来源追溯，打包后这些原图不随包分发，不影响本地知识检索。

## 开发验证（在源码仓库内）

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-quartus-recorder.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-quartus-capture-profile.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package-quartus-recorder.ps1 -IncludeNode
```

捕获配置测试加载编译后的程序，检查进程归属、manifest、强制视觉采集和键盘取证规则；不安装输入监听、不截图、不操作软件、不调用 API。其余离线入口：`node --test tests/quartus-knowledge.test.mjs tests/quartus-analysis.test.mjs tests/quartus-project.test.mjs`。模拟模型和受控测试运行时验证的是数据契约，不能作为真实 API 识别率或真实 Quartus 执行成功率。

跨段确认修复后的 Quartus 定向离线回归 **130 项通过、0 失败、1 跳过**（Windows 禁止创建文件符号链接），未调用 API，也未复跑远程软件。真实完整录制的 7 段旧模型结果已离线重新校验，生成构建材料，3 个误判缺口消除；实际重建、编译及结果对照待验证。此前事件引用修复批次 84/84、相关批次 102/102、扩大批次 121/122（1 项既有 PSCAD 模板 PLAN 测试不匹配）属于不同批次，不相加。具体实机状态见上述验收文档。
