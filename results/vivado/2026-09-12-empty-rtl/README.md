# Vivado 实机运行结果 — 2026-09-12

本目录保存 **Vivado 2024.2 空 RTL 工程配置** 的首次真实录制 → 付费 API → 接口 JSON → 原生回放 → 独立对照结果。按用户要求发布运行产物；原始录制、截图、API 请求/响应、检查点及密钥不发布。

## 结论与范围

回放创建并保存、关闭、重开了 `VivadoSmoke_20260912_A`。工程名、器件 `xc7vx485tffg1157-1`、VHDL 目标语言、Mixed 仿真语言与录制时独立观察相同。设计源和约束均为 0，顶层未定义，综合和实现均未启动。

这是空工程配置样本，不是完整硬件设计。未验证 HDL 恢复、综合、实现、仿真、bitstream、IP、硬件或所有 UI 功能。VM 系统日期错误，文件内 2014 年时间戳不是本次任务日期；未修改 VM 时间。

## 文件

| 文件 | 内容与来源 |
| --- | --- |
| [replay-plan.json](replay-plan.json) | 分段模型结果经过校验、合并后的接口调用计划；发布时保持原文件字节不变。 |
| [vivado-validation.tcl](vivado-validation.tcl) | 由计划自动编译、在 VM 内实际执行的脚本；未手改。 |
| [native/project 工程文件](native/project/VivadoSmoke_20260912_A.xpr) | 从 VM 回放目录取回的真实 Vivado 工程，未重新创建或修改。 |
| [native/calls.log](native/calls.log) | 实际运行时由脚本写出的三次调用记录。 |
| [native/verification-status.txt](native/verification-status.txt) | 实际运行时的调用、保存重开检查标记；不单独证明与录制一致。 |
| [independent-source-truth.json](independent-source-truth.json) | API 分析前独立记录的源工程属性；未作为模型输入。 |
| [native-verification.json](native-verification.json) | Computer Use 实机观察及独立读回的对照报告；不是机器导出的日志。发布副本只更新同目录真值文件链接。 |
| [run-report.md](run-report.md) | 验证范围、流程问题、修复及 API token 账目。 |
| [manifest.json](manifest.json) | 发布产物的 SHA-256 和字节数。只用于完整性检查，不替代实机验证。 |

计划内的 `nativeVerification.status=not_run` 是生成计划时的状态，特意保留原样；后续实测结论在独立 `native-verification.json`。原生状态文件中的 “Source-recording comparison still required” 也保持原样，后续对照结果由独立报告提供。

## 查看与使用

1. 阅读接口 JSON，查看 AI 选择的 `create_project` 和两次 `set_property` 及对应参数。
2. 用安装了对应器件支持的 Vivado 2024.2 打开 `native/project/VivadoSmoke_20260912_A.xpr`。这是原生存档副本；跨机器重开本发布副本尚未验证。XPR 内保留原 VM 的路径元数据，缓存和本机 UI 布局文件未发布。
3. 需要再次执行时，先阅读 Tcl，关闭当前工程，在新的可写工作目录运行它。脚本会创建唯一命名的隔离子目录；同名目录存在时拒绝覆盖。不需要 API 密钥，也不会再次请求模型。

本目录单独发布运行结果，不代表其他尚未提交的 recorder 开发改动已经上传。完整原始证据仅留本地，因此本发布包不能独立重做 VLM 输入审计。
