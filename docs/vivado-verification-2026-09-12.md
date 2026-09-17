# Vivado 验证记录 — 2026-09-12

结论：**首个小范围实机闭环通过**。VM 内录制 → 本地付费 API → AI 选择接口的 JSON → 自动生成验证 Tcl → 新目录执行 → 保存重开 → 独立对比，均已完成。仅证明本次空 RTL 工程配置，不是全 Vivado 验证。用户已明确授权启动录制器、录制传回、API 和隔离回放。

## 环境与部署

- VM2：Vivado 2024.2 英文版。仅操作本任务创建的探针、源测试和回放工程，未修改其他工程。
- VM 的显示日期错误（2014-01-21），本轮不修改时间、许可证或系统设置。
- 无密钥包：`C:/Users/user/Documents/vivado-vm-1789250560836`，已运行 EXE、完成录制和停止。
- 录制器 SHA-256：`054D4D0D995BE7250290FD732727861DC634AAD2839F63384A9325117EE11204`。EXE 与本地构建一致；部署包内分析器早于后续本地校验修订，实际分析应拉回本地执行，不声称 VM 包内所有文件是最新版。
- 配置仅来自白名单示例，不包含 `.env`、用户密钥、用户配置、录制、源码工程或请求体。

## 已完成检查

- 200 条 UI 条目及父子/来源/命令引用检查。
- 7 个有界原生 Tcl 接口目录；新增 `get_filesets` 使用 Vivado 已安装帮助核实，并明确网站页面未读取的范围。
- `tests/vivado-knowledge.test.mjs`：10/10。
- `tests/vivado.test.mjs`：17/17；包括模型显式接口、对象生命周期、分段合并、证据覆盖、未知源文件拒绝、参数归属、同运行失败反馈重试、多级检查点来源验证、Tcl 引用与排他输出。
- 本轮既有 JMP 53 项回归通过；Vivado 与 JMP 录制器均编译成功。它们不是 Vivado 实机验证替代品。
- 综合必须有 `sources_1` 内容，实现必须有已观察完成的综合；当前 schema 不支持 bitstream，不能把 route_design 成功冒充 write_bitstream。

## 真实录制与原生验证

- 本地录制：`bin/vivado-recorder/recordings/20140121-181934-7f017c`。35 个事件、42 个截图文件，全部事件进程为 VM 内 `vivado`，同 Windows 会话，2560×1440 桌面截图。
- 本次 UI Automation 只取得 Java 窗口层 `SunAwtFrame/SunAwtDialog`，AutomationID 为空，不能声称已取得按钮 ID。识别主要依赖图像、输入与 UI Map。
- 未读取工程、HDL、Tcl journal 或剪贴板内容作分析证据；独立真值在 API 前记录且未上传。密钥仅在本地使用。
- 有效输出在录制下 `generated-vivado/eaaa5de226f5adc7ef65c06d`。主交付 `replay-plan.json` 由模型返回 3 次调用：创建项目、设置目标语言、设置仿真语言。
- 通用编译器从同一 JSON 生成 `vivado-validation.tcl`，复制到 VM 后执行一次。关闭源测试工程后，在 UUID 新目录创建、保存、关闭、重开并核对属性，控制台出现 `VIVADO_REPLAY_PASS`。
- 回放项目：`C:/Users/user/AppData/Roaming/Xilinx/Vivado/VivadoReplay-72e8b43a-7823-4362-bdd4-60a9326ed13c/project/VivadoSmoke_20260912_A.xpr`。
- 原工程 `C:/Users/user/VivadoSmoke_20260912_A/VivadoSmoke_20260912_A.xpr` 保留，不覆盖。

| 属性 | 录制时独立观察 | 回放后 GUI / 原生读回 |
| --- | --- | --- |
| 工程名 | VivadoSmoke_20260912_A | 相同 |
| FPGA part | xc7vx485tffg1157-1 | 相同 |
| 目标 / 仿真语言 | VHDL / Mixed | 相同 |
| 设计源 / 约束数量 | 0 / 0 | 0 / 0 |
| 顶层 | Not defined | 原生空字符串，GUI Not defined |
| 综合 / 实现 | Not started / Not started | 相同 |

独立只读查询输出：

```text
SOURCE_COMPARISON VivadoSmoke_20260912_A xc7vx485tffg1157-1 VHDL Mixed design_sources 0 constraints 0 top {} synthesis {Not started} implementation {Not started}
```

输出目录的 `native-verification.json` 是依据 Computer Use 实机观察写下的对比报告，明确标注不是原生机器导出的日志。模型计划的 `not_run` 保留，验证通过由独立报告、plan/script 哈希及 VM 日志关联。

尚未验证：完整可见 HDL 恢复、顶层设置、综合/实现运行。约束、仿真、IP/Block Design、bitstream、硬件仍未支持。200 条 UI 条目不是 200 个按钮全部实测。未核实 Enterprise 许可或全部器件/IP access。

## API 账目

- 请求配置 `gpt-5.6`、low reasoning，实际响应模型 `gpt-5.6-sol`。本次独立配置为 high 图像细节，以辨认器件小字；全局配置未改。
- 哈希去重后 29 张独立图，3 段分别 10/12/8 个图像位置；一张跨段重复，原始时间与事件身份保留。
- 总上限 6 次尝试；实际 1 次本地 EACCES 连接失败、5 次完整 API 响应，其中 2 次因结构校验失败重试。没有无限重试或整轮重传。

| 响应内容 | 输入 tokens | 缓存输入（已含输入内） | 输出 tokens |
| --- | ---: | ---: | ---: |
| 第 1 段有效 | 34,886 | 0 | 496 |
| 第 2 段首次无效引用 | 41,099 | 1,702 | 766 |
| 第 2 段修复 | 41,699 | 1,702 | 670 |
| 第 3 段首次无效状态/receiver | 29,402 | 1,702 | 1,047 |
| 第 3 段修复 | 30,331 | 1,702 | 992 |
| 合计 | 177,417 | 6,808 | 3,971 |

有 usage 的总计 181,388 tokens；推理 tokens 已含输出，不另加。EACCES 没有服务端响应/usage，计费标为未知，不宣称零费用；美元费用按实际账单核对。

## 本轮修复与教训

第二段把事件 ID 写进 selectionIds；最后段把延续状态写成 blank，并为 create_project 编造 session receiver。参数识别正确，但返回被严格拦住。修改的是 harness：错误反馈、只重试失败段、验证原始请求与响应内容/图片哈希/上下文/契约后复用已通过段，支持多次修订的来源链。没有手改模型结果或验证脚本。

新请求预先提供接口绑定规则，明确 continuation、空 session receiver、事件 ID 与对象 ID 分离；该预防提示已离线测试，本轮没有为它再付费重跑整条录制。离线重编译已用本次多级来源验证通过，零 API；usage 合并历史尝试，避免只展示末次成本。

本轮分析阶段回归 80/80（Vivado 27、JMP 53）。录制、截图、请求体留本地并被 Git 忽略。之后用户授权发布运行结果，已单独推送 `7380479`；不是整个开发工作区已推送。

## 单文件交付更新

用户随后明确要求一个直接在软件运行的文件。因此 Vivado 默认主交付改成 `vivado-replay.tcl`，内部 JSON 移至 `_internal/replay-plan.json`；API 仍返回受约束的接口选择，不改成任意脚本文本。录制器新增“打开脚本位置”和简洁的生成/暂停提示。没有删除原始证据或历史发布快照。

新增默认 Tcl、旧选项无重复文件、离线编译无需配置/请求、未完成计划拒绝脚本、HDL 内嵌等检查。离线回归 83/83（Vivado 30、JMP 53），本地录制器重新编译。实际完成的旧 API 运行已通过来源检查后生成新的单文件 Tcl，零 API；去掉注释并归一化隔离 UUID 后，与此前实机脚本正文一致。本次没有再次操作 Vivado，也未将新 EXE 部署到 VM，不宣称新 UI 已实测。
