# Vivado HDL 录制到单文件回放验证 — 2026-09-12

结论：**本次基础 HDL 样例端到端通过**。VM 内 GUI 新建/编辑 Verilog → recorder 采集 → 本地真实 API 分析 → 通用编译器生成单文件 Tcl → VM 中新隔离工程执行 → 保存重开 → 原生只读对照，均已完成。不是完整 Vivado、时序收敛或硬件验证。

## 范围与环境

- Vivado 2024.2 英文版，Build 5239630，VM2。VM 时间仍错误地显示 2014-01-21；未修改时钟、许可或安全设置。
- 源工程为本任务新建的 `C:/Users/user/VivadoLogic_20260912_B/VivadoLogic_20260912_B.xpr`，没有覆盖已有用户工程。
- 原始操作：新建 RTL 工程；向导创建模块模板；在编辑器中替换为完整可见的 XOR HDL 并保存；综合；实现至 route_design。
- 录制期间 UI Automation 关闭。输入来自 VM 同一 Windows 会话的截图与基础事件，不是外层 RDP 截图，也不是原生工程/journal/剪贴板读取。
- HDL 与预期属性的独立 GUI 基线在 API 前保存，未作为模型输入。原生源工程审计在分析完成后、关闭源工程前导出，仅用于验证。
- 本轮修改仅涉及分析 harness 与回归测试，未重新构建 EXE；VM 包内分析器仍旧，实际分析在本地完成。

## 本轮修复

首轮第 5 段出现两个问题：模型把 add_files 的接收对象写成文件集，而契约要求工程对象；同时在编辑尚未完成时提前固化了向导模板。

修复的是 `src/analyzer/vivado-cli.mjs` 的通用提示/修复反馈：

1. add_files 的 receiverId 指向已存在的工程，文件集通过 arguments.fileset 指定，resultId 为空。
2. 新建源文件及紧随的编辑过程视为同一待提交事务；非末段末尾仍在编辑、特别是全选准备替换时，延后 artifact/add_files，同时保留创建证据。
3. 在可观察的保存、关闭编辑器或编译边界提交完整可见源码，不猜测剪贴板内容。
4. 已提交源码再次修改属于当前尚不支持的多版本流程，要求 unresolved，不能静默改写旧版本。

这些是 harness 指导，不是已经实现任意源码版本管理。没有硬编码此项目名或 XOR 内容，没有手改 API 返回、内部计划或最终 Tcl 来通过验证。

## 录制、请求与文件

- 录制：`bin/vivado-recorder/recordings/20140121-222513-b595f4`。
- 77 个事件，91 个引用截图文件，按 SHA-256 去重后 78 张图。
- 7 段分别上传 12 / 11 / 12 / 11 / 10 / 12 / 10 张图。晚到截图保留采集时间归属警告，不自动视为相邻操作的结果。
- 关键截图：`evt-00000058-before.jpg` 为待替换模板；`evt-00000059-after.jpg` 为完整最终 HDL；`evt-00000077.jpg` 为原工程完成后的摘要。
- 主交付：`generated-vivado/4fd76311749ec6d3d683d95a/vivado-replay.tcl`。内部计划位于同目录 `_internal/replay-plan.json`。
- 最终 Tcl 内嵌源码，不依赖旁边的 JSON、录制、Node.js 或 API 密钥。它要求先关闭当前工程，在当前工作目录创建新的排他输出目录；同一目标目录已存在时拒绝覆盖。
- 旧有效分段 1–4 经请求、证据哈希、上下文与契约来源检查后复用；只处理后续失败/未完成分段，没有整段录制无限重传。

## 实机执行与独立对照

最终 Tcl **未修改，执行一次**。在 Vivado GUI 的 Tcl Console 中 source 文件，观察到等待运行的进度窗口，综合、实现完成后脚本继续并保存重开，控制台出现 `VIVADO_REPLAY_PASS`。

回放工程：

`C:/Users/user/AppData/Roaming/Xilinx/Vivado/VivadoReplay-092d71b8-483b-4ddb-a152-2f8de1387514/project/VivadoLogic_20260912_B.xpr`

| 对照项 | 原录制工程 | 回放工程 | 依据 |
| --- | --- | --- | --- |
| 工程名 | VivadoLogic_20260912_B | 相同 | 原生属性读回 |
| part | xc7a200tsbg484-1 | 相同 | 原生属性读回 |
| 目标 / 仿真语言 | Verilog / Mixed | 相同 | 原生属性读回 |
| 顶层 | replay_logic | 相同 | 原生文件集属性；本例由 Vivado 自动确定 |
| 设计源 / 约束数 | 1 / 0 | 1 / 0 | 原生文件列表 |
| 完整 HDL | 两输入 XOR，见下文 | 文本完全相同 | 原生文件读取、独立基线、本地回放文件三方对照 |
| synth_1 | synth_design Complete! / 100% | 相同 | 原生运行属性 |
| impl_1 | route_design Complete! / 100% | 相同 | 原生运行属性 |
| LUT / FF | 1 / 0 | 1 / 0 | 原工程 GUI；回放 GUI 与 utilization 报告 |
| 布线错误 | 0 | 0 | 原工程 GUI；回放 route_status 报告 |

唯一归一化差异为源文件所在的隔离目录；原生审计文本统一换行后比较，其他属性、HDL 内容未放宽。回放真实源码文件也与 API 前的独立基线一致。

```verilog
module replay_logic(input wire a, input wire b, output wire y);
  assign y = a ^ b;
endmodule
```

回放综合耗时约 30 秒，实现约 1 分 38 秒；原 GUI 实现约 1 分 37 秒。这是 Vivado 运行时间，不是 API 分析耗时。回放报告显示 3 条可布线网络全部完成，路由错误 0，1 个 LUT2、3 个 IOB。没有做形式等价、仿真真值表或硬件测试。

## 警告与明确限制

- 路由 DRC：NSTD-1（未指定 I/O 标准）、UCIO-1（未指定端口引脚位置）两项 critical warning；CFGBVS-1（未指定配置电压属性）一项 warning。
- 没有 XDC、用户时序约束或时钟；时序为 NA，报告提示无法据此确认时序/功耗精度。
- 未降低 DRC 严重级别，未猜测板卡引脚、I/O 标准或电压，未生成 bitstream、连接/烧录硬件。
- 本次只验证单个完全可见源文件的一次初始编辑和编译。显式切换 top、多文件依赖、已编译后再次编辑、IP/Block Design、仿真均未实测。
- UI Map 仍为部分覆盖的 200 条界面条目，不是全部按钮已测。
- 本次验证的是 GUI 中 source 整个脚本的执行上下文，不把它推广为所有 GUI 单行交互 wait_on_runs 都会等待；仍需终态断言。

## 审计与回归

原生输出经 Explorer 从 VM 复制到本地：

`.equile-local/vivado-hdl-20260912/VivadoReplay-092d71b8-483b-4ddb-a152-2f8de1387514/`

包含 `source-replay-audit.txt`、`calls.log`、`verification-status.txt`、回放 HDL/XPR 及原生综合/实现报告。源码录制、图片、请求与该目录继续留本地；本轮未 commit/push。

| 文件 | SHA-256 |
| --- | --- |
| vivado-replay.tcl | 8054157B31C3DF917795BA13D1CD5B3EBA158BA363052780DCE9B4A18DF41703 |
| _internal/replay-plan.json | 546F20A794F3673F4809586C6BBEBCC780E2D4F7DD758F287B2BD10DF6490513 |
| source-replay-audit.txt | 1C49AA640BE37C91EBAC86EB3E0AA7B7CFD07F3BF33F5109242A208229616C3B |
| replay_logic.v | 5D57170F2790E0A32B29E701B1C33B683E8FC5F4EC6A82F29EB7C30826F223A8 |

本页是代理依据实际 UI 和原生导出撰写的报告，不伪装为软件自动导出。模型计划及生成阶段 status.json 的 not_run 保留；它们描述生成时状态，实际执行与对照由本报告和独立原生审计关联。

- 集成工作副本基线：`e7390e96cf5ab12269f5a48874f1b3173212acf6`，本轮 harness/test 改动尚未提交。
- 当前离线回归 **86/86**：Vivado 31、JMP 55；主工作区 Vivado 31/31 也通过。
- 集成工作副本和主工作区的本轮分析器/测试修改已核对一致；没有覆盖其他人的未提交修改。
- 这些离线测试不是额外的真实 API 准确率样本。

## API 账目与停止点

授权上限 9 次尝试，实际 9 次：8 次完整响应（含 1 次校验失败），1 次 TLS bad record mac 失败；7 个有效分段完成。未再追加付费调用。

| 统计 | 数量 |
| --- | ---: |
| 有 usage 的输入 tokens | 302,553 |
| 其中缓存输入（已包含在输入中） | 11,914 |
| 输出 tokens（含推理） | 7,721 |
| 有 usage 的总 tokens | 310,274 |
| 无 usage 的失败尝试 | 1 |

请求配置为 gpt-5.6、low reasoning、high 图像细节；响应模型为 gpt-5.6-sol。TLS 失败的计费未知，不算作零费用；美元费用需与实际提供方账单核对。
