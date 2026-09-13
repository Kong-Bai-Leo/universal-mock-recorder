# Vivado 首轮适配状态与接口契约

更新：2026-09-13。开发基线先读 [JMP 复盘](jmp-lessons-and-vivado-agenda.md)。本页是分阶段进度，不是全部功能完成声明。

最新：顶层视觉事务、运行失效保护、知识来源/重复查询校验及显式离线导出已实现。**117 项离线回归通过（Vivado 62、JMP 55）；两源码样本已在 Vivado 中完成综合、布线、保存重开和独立电路对照。** 首次原生运行因内存耗尽失败，正常重开本任务 Vivado 后隔离重跑通过，未改变设计。此前 4 次真实 API 请求约 $0.79，本轮新增 0 次。详见 [原生验证](vivado-state-native-verification-2026-09-13.md) 和 [API 回归](vivado-state-api-test-2026-09-13.md)。VM 录制器包尚未更新，不能将本地分析器进展等同于已部署。

## 首轮实机确认（空工程历史）

- VM2 中 About 显示 **Vivado v2024.2 (64-bit)**，英文界面，SW Build 5239630。启动页标注 ML Edition，尚未核实 Enterprise 许可、所有器件或收费 IP 的可用性。
- 在新隔离目录 `C:/Users/user/vivado_uimap_probe_20260912` 创建了一个空 RTL 工程，未打开、修改其他工程。
- 向导中的目标器件为 `xc7vx485tffg1157-1`；这是本次扫描取值，不是分析器默认器件。未添加源文件/约束，顶层为空。
- 工程摘要和 Tcl Console 确认工程创建；`synth_1`、`impl_1` 均为 Not started。**没有综合、实现、仿真或生成 bitstream。**
- VM 任务栏日期显示 1/21/2014，本轮未修改时间或许可证。文档记录使用任务日期；以后许可/网络检查需注意此差异。
- RDP 只作为操作通道；已确认 35 个录制事件来自 VM 内 `vivado`，同 Windows 会话截图，不是外层 `mstsc`。本次 UIA 仅有窗口层信息，没有按钮 AutomationID。

## 支持矩阵（含后续 HDL 验证）

| 范围 | 已编码 | 离线检查 | 实机观察/操作 | 真实录制→VLM→JSON→还原 |
| --- | --- | --- | --- | --- |
| 静态 UI Map、父子关系、独立 live observation | 是，部分覆盖 | 203 条界面条目的 ID/引用/来源校验，新增 3 条为文档知识而非新实机扫描 | Home、Help、新工程 RTL 路径、主要工程入口、General 设置 | 新顶层语义用于局部真实 API，往返切换已识别并实机回放验证 |
| 按需检索 UI 与官方命令 | 是，独立模块与检查入口 | 同名按钮、预算遗漏、未知输入、断裂引用回归 | UI 条目来自实机观察；不是按钮全功能测试 | 已用于真实 API，不代表所有控件识别通过 |
| Tcl 接口知识 | 七项有界目录 | 目录和相关控件/来源引用校验 | 创建/属性、add_files、get_runs、launch_runs、wait_on_runs、保存重开通过 | 本轮单源码参数组合通过；不是所有参数组合 |
| 独立 Vivado recorder/analyzer、接口调用 JSON schema、执行器 | 已实现有界版本 | 最新 62 项 Vivado、55 项 JMP 回归通过 | VM 录制、拉回分析、隔离回放完成；新保护成功路径实测 | 空 RTL、单 HDL 历史样本通过；两源码新修订原生对照通过，前 11 段为旧上下文 |
| 完整可见 HDL、源文件集、顶层设置 | 已编码，有界单版本 | 精度、文件名、对象归属、编辑事务提示检查 | 单文件及后续两文件全文、sources_1、最终 top 实测一致 | 单文件通过；两文件新回放补齐中途 top 并通过原生断言与源码对照 |
| 综合/实现运行状态 | 有界接口已编码 | 源文件、先综合后实现、启动/等待/预算/终态校验 | 单文件及两文件 synth/route、重开通过；两文件本轮首次 OOM 后干净会话重跑成功 | 两样本有界流程通过，无时序/硬件验收；内存不足可再次影响运行 |
| 约束/仿真/IP/硬件 | 未实现 | 拒绝超出当前接口白名单的操作 | 仅部分入口观察 | 未验证 |

203 条包含页面、面板、分组、字段、图标和按钮，**不是 203 个已实测按钮，更不是全软件覆盖**。未打开菜单和图标工具栏缺口见 [UI Map 索引](../ui-maps/vivado/2024.2/en-US/index.json)。

## 文件职责与使用

- [index.json](../ui-maps/vivado/2024.2/en-US/index.json)：分区入口和未覆盖范围。
- 各分区 `ui-map.json`：稳定层级/标签/功能，区分观察与语义核实状态，不保存点击坐标。
- [live-observation.json](../ui-maps/vivado/2024.2/en-US/live-observation.json)：本次窗口布局、区域与观察事实；图片保留在本任务的 Computer Use 工具历史，未导出为仓库图片。
- [command-catalog.json](../ui-maps/vivado/2024.2/en-US/command-catalog.json)：带官方来源的接口候选；**不是可执行白名单**。
- [vivado-knowledge.mjs](../src/analyzer/lib/vivado-knowledge.mjs)：加载、引用检查和有界检索；未修改现有 JMP/AutoCAD/3ds Max 分析器。

本地检查，不调用 API：

```powershell
node scripts/inspect-vivado-knowledge.mjs
node scripts/inspect-vivado-knowledge.mjs "Add Files"
node --test tests/vivado-knowledge.test.mjs
```

检索会同时提供 Add Sources 和 Add Constraints 下的 Add Files 及各自完整父路径，留给分析器结合当前截图判断。检索 ID 是本地地图 ID，不是原生 Automation ID。预算截断会列出未返回条目，陌生命令不会自动替换成最相近命令。检索启动运行时还会提供 get_runs / wait_on_runs 等伴随检查接口；预算不足时明确列出缺失项。

首轮测试与条件编译结果见 [空工程验证记录](vivado-verification-2026-09-12.md)。后续 HDL 轮次离线测试 **86/86（Vivado 31、JMP 55）**，真实录制/API/单文件回放与独立原生对照通过，详见 [HDL 验证记录](vivado-hdl-verification-2026-09-12.md)。命令目录的 offline 状态是 foundation-1 创建时的快照，最新实测以独立验证记录为准，不把接口所有参数组合升级为通过。

## 已实现的有界 JSON 契约

2026-09-12 用户更新交付要求：主交付改为 **一个可在 Vivado 中直接运行的 `vivado-replay.tcl`**。AI 仍在内部返回接口、接收对象和参数的 JSON，由受控编译器自动生成 Tcl；`_internal/replay-plan.json` 只供审计，不要求用户另交给执行 AI。脚本内嵌受支持的精确 HDL 内容，运行不依赖旁边的 JSON、录制文件、Node.js 或密钥。历史发布快照不回写。

生成器现在默认输出 Tcl，不再需要 `--export-validation-tcl`。本地录制器成功提示和“打开脚本位置”指向 Tcl。此次交付变更离线回归 83/83（Vivado 30、JMP 53），本地 EXE 编译成功；旧真实 API 结果零请求重编译成功，新 UI 尚未部署至 VM。此前实机结果的范围不扩大。

当前 `vivado-native-plan-2` 保留原接口操作，并增加 `topTransactions`（前后模块状态、稳定性、指示标识、截图引用、提交/取消/待完成状态和对应接口操作）。旧 plan-1 不静默升级为已验证成品；付费局部回归仅允许有来源核验的有限旧上下文。独立的显式离线导出入口可再次核验全部来源与最终结构后编译 Tcl，明确 fullyReanalysed=false；不绕过普通完整分析的检查点校验。每项操作包含：

- 操作标签、来源事件/截图、提交时间和阶段。
- `apiCall`：由 AI 明确选择 catalog 命令、结构化参数、已绑定对象引用；本地只校验和序列化，不补写模型未提供的操作。
- 稳定工程/文件集/源文件/运行 ID；逻辑 ID 与原生句柄分离，按时间创建和唯一绑定。
- `artifacts`：仅支持截图中完整可见、精确转写的 HDL 源文件，记录名称、内容、精度和来源事件。不读取目标原生文件补答案，不支持 XDC、include、IP 依赖。文件名和按钮点击不能恢复不可见内容；缺少依赖则阻止完整回放。
- `expectedState`：工程属性、实际源列表、顶层、器件、运行目标步骤和结果。仅描述录制中有证据的状态；未知或失败不强行改写成功。
- `pending` 与 `unresolved` 分离；前段遗漏不能被末段 complete=true 清空。取消、重试、覆盖、改变顶层/器件引起的运行失效需独立处理。

### 执行保护与异步状态

执行端使用 UUID 隔离目录、排他文件创建，不使用 `-force`，不开放 Tcl hooks、任意 shell、网络、硬件烧录，只序列化 AI 已选择的白名单接口。后续 HDL 样例已验证保存重开、器件/语言、完整源码、源列表、自动顶层及 synth/route 运行终态；没有扩展为仿真、时序收敛或硬件验收。

分析器默认仅本地 Prepare；每轮最多 2 请求、每请求最多 12 张图、6000 输出 tokens、8 MB 请求体。成功分段保存检查点；无自动失败重试，失败后需显式重试；录制、图片、请求体默认被 Git 忽略。真实 API 的总轮数需结合 Prepare 清单限定。上传后成功与否均保留记录，计费未知不能算作 0。

`launch_runs` 只是启动；`wait_on_runs` 结束也可能意味着错误或超时，而且该命令在 GUI 交互模式中会被忽略。执行器应在适用模式使用有界等待，随后核实实际运行对象的 PROGRESS、STATUS、目标步骤和产物；时序是否达标另行检查。[AMD 2024.2 官方说明](https://docs.amd.com/r/2024.2-English/ug835-vivado-tcl-commands/wait_on_runs)

## 最新进展与下一阶段验收

后续已完成单个完全可见 HDL 的创建/初始编辑、综合、实现至 route_design、保存重开和原生独立对照。分析 harness 新增“模板未提交—编辑—保存/编译边界”的通用规则及 add_files 接收对象提示；没有手改输出脚本。

1. 两源码/顶层切换样本的历史失败见 [多文件验证记录](vivado-hierarchy-verification-2026-09-12.md)。后续修正视觉状态、局部真实 API 复验并隔离重跑，现已匹配中间切换、源码、配置及最终电路，详见 [本轮原生验证](vivado-state-native-verification-2026-09-13.md)。更早一次 place_design 异常根因仍未独立确定；多版本源码、reset/rebuild 仍待支持。
2. 按需补齐 Add Sources、Define Module 和编辑器相关 UI Map 缺口；203 条现有条目不是全覆盖。
3. XDC/时序约束、IP、仿真、bitstream、硬件仍在范围外；本次无约束布线成功不能替代这些验收。

发布范围为代码、合成测试、UI Map、阶段报告和已验证的独立 Tcl/脱敏结果摘要。原始录制、截图、请求、provider 响应及原生全量日志保留本地。旧多文件分析用量与后续 4 次局部 API 用量分别见对应报告，不混同本轮 0 新增请求。VM 包内分析器早于本地修订，当前方式仍是 VM 录制后传回本地分析。
