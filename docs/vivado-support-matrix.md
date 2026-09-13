# Vivado 首轮适配状态与接口契约

更新：2026-09-12。开发基线先读 [JMP 复盘](jmp-lessons-and-vivado-agenda.md)。本页是分阶段进度，不是全部功能完成声明。

## 实机确认

- VM2 中 About 显示 **Vivado v2024.2 (64-bit)**，英文界面，SW Build 5239630。启动页标注 ML Edition，尚未核实 Enterprise 许可、所有器件或收费 IP 的可用性。
- 在新隔离目录 `C:/Users/user/vivado_uimap_probe_20260912` 创建了一个空 RTL 工程，未打开、修改其他工程。
- 向导中的目标器件为 `xc7vx485tffg1157-1`；这是本次扫描取值，不是分析器默认器件。未添加源文件/约束，顶层为空。
- 工程摘要和 Tcl Console 确认工程创建；`synth_1`、`impl_1` 均为 Not started。**没有综合、实现、仿真或生成 bitstream。**
- VM 任务栏日期显示 1/21/2014，本轮未修改时间或许可证。文档记录使用任务日期；以后许可/网络检查需注意此差异。
- RDP 只作为操作通道；已确认 35 个录制事件来自 VM 内 `vivado`，同 Windows 会话截图，不是外层 `mstsc`。本次 UIA 仅有窗口层信息，没有按钮 AutomationID。

## 支持矩阵

| 范围 | 已编码 | 离线检查 | 实机观察/操作 | 真实录制→VLM→JSON→还原 |
| --- | --- | --- | --- | --- |
| 静态 UI Map、父子关系、独立 live observation | 是，部分覆盖 | 200 条界面条目的 ID/引用/来源校验 | Home、Help、新工程 RTL 路径、主要工程入口、General 设置 | 已实际上传检索结果；空 RTL 工程样本通过 |
| 按需检索 UI 与官方命令 | 是，独立模块与检查入口 | 同名按钮、预算遗漏、未知输入、断裂引用回归 | UI 条目来自实机观察；不是按钮全功能测试 | 已用于真实 API，不代表所有控件识别通过 |
| Tcl 接口知识 | 七项有界目录 | 目录和相关控件/来源引用校验 | create_project、语言 set_property、保存重开通过 | 仅上述接口的本次参数组合通过 |
| 独立 Vivado recorder/analyzer、接口调用 JSON schema、执行器 | 已实现有界版本 | 27 项 Vivado、53 项 JMP 回归通过 | VM 录制、拉回分析、隔离回放均完成 | 首个空 RTL 工程配置样本通过 |
| 完整可见 HDL、源文件集、顶层设置 | 已编码 | 精度、文件名、对象归属和引用检查 | 尚未实机回放 | 未验证 |
| 综合/实现运行状态 | 有界接口已编码 | 源文件、先综合后实现、启动/等待/预算/终态校验 | 尚未运行；不含 bitstream | 未验证 |
| 约束/仿真/IP/硬件 | 未实现 | 拒绝超出当前接口白名单的操作 | 仅部分入口观察 | 未验证 |

200 条包含页面、面板、分组、字段、图标和按钮，**不是 200 个已实测按钮，更不是全软件覆盖**。未打开菜单和图标工具栏缺口见 [UI Map 索引](../ui-maps/vivado/2024.2/en-US/index.json)。

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

本轮 Vivado 测试 **27/27**，JMP 回归 **53/53**；录制器条件编译成功。另有真实录制/API/接口回放与独立比较通过，范围和账目见 [本轮验证记录](vivado-verification-2026-09-12.md)。命令目录的 offline 状态是 foundation-1 创建时的快照，最新实测以独立验证记录为准，未把全部七项接口升级为通过。

## 已实现的有界 JSON 契约

2026-09-12 用户更新交付要求：主交付改为 **一个可在 Vivado 中直接运行的 `vivado-replay.tcl`**。AI 仍在内部返回接口、接收对象和参数的 JSON，由受控编译器自动生成 Tcl；`_internal/replay-plan.json` 只供审计，不要求用户另交给执行 AI。脚本内嵌受支持的精确 HDL 内容，运行不依赖旁边的 JSON、录制文件、Node.js 或密钥。历史发布快照不回写。

生成器现在默认输出 Tcl，不再需要 `--export-validation-tcl`。本地录制器成功提示和“打开脚本位置”指向 Tcl。此次交付变更离线回归 83/83（Vivado 30、JMP 53），本地 EXE 编译成功；旧真实 API 结果零请求重编译成功，新 UI 尚未部署至 VM。此前实机结果的范围不扩大。

当前 `vivado-native-plan-1` 每项操作包含：

- 操作标签、来源事件/截图、提交时间和阶段。
- `apiCall`：由 AI 明确选择 catalog 命令、结构化参数、已绑定对象引用；本地只校验和序列化，不补写模型未提供的操作。
- 稳定工程/文件集/源文件/运行 ID；逻辑 ID 与原生句柄分离，按时间创建和唯一绑定。
- `artifacts`：仅支持截图中完整可见、精确转写的 HDL 源文件，记录名称、内容、精度和来源事件。不读取目标原生文件补答案，不支持 XDC、include、IP 依赖。文件名和按钮点击不能恢复不可见内容；缺少依赖则阻止完整回放。
- `expectedState`：工程属性、实际源列表、顶层、器件、运行目标步骤和结果。仅描述录制中有证据的状态；未知或失败不强行改写成功。
- `pending` 与 `unresolved` 分离；前段遗漏不能被末段 complete=true 清空。取消、重试、覆盖、改变顶层/器件引起的运行失效需独立处理。

### 执行保护与异步状态

先验证新工程 + 明确设置，再验证完全可见源文件。执行端使用 UUID 隔离目录、排他文件创建，不使用 `-force`，不开放 Tcl hooks、任意 shell、网络、硬件烧录，只序列化 AI 已选择的白名单接口。保存重开与器件/语言读回已实测通过；源文件与运行结果读回尚未实测。

分析器默认仅本地 Prepare；每轮最多 2 请求、每请求最多 12 张图、6000 输出 tokens、8 MB 请求体。成功分段保存检查点；无自动失败重试，失败后需显式重试；录制、图片、请求体默认被 Git 忽略。真实 API 的总轮数需结合 Prepare 清单限定。上传后成功与否均保留记录，计费未知不能算作 0。

`launch_runs` 只是启动；`wait_on_runs` 结束也可能意味着错误或超时，而且该命令在 GUI 交互模式中会被忽略。执行器应在适用模式使用有界等待，随后核实实际运行对象的 PROGRESS、STATUS、目标步骤和产物；时序是否达标另行检查。[AMD 2024.2 官方说明](https://docs.amd.com/r/2024.2-English/ug835-vivado-tcl-commands/wait_on_runs)

## 下一阶段验收

1. 完整可见的小 HDL 样本、源文件集与顶层设置；独立核对内容，不从原工程补答案。
2. 在完整源依赖基础上验证综合，再验证实现终态；空工程成功不替代运行测试。
3. 完善上述工作流缺少的对话框、菜单和工具栏；IP、仿真、bitstream、硬件仍在范围外。

本轮 API 与实机小闭环已完成；原始证据及请求记录仅在本地，未 commit/push。VM 包内分析器早于本地修订，当前方式是 VM 录制后传回本地分析。
