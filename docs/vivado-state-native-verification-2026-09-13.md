# Vivado 顶层状态修复：原生回放验证（2026-09-13）

## 结论

本样本通过 **真实录制 → 已保存真实 API 响应 → 受控 Tcl 编译 → 隔离 Vivado 执行 → 保存重开 → 独立原生对照**。两份 HDL、工程设置、先切换到子模块再恢复父模块、综合及布局布线结果均匹配。

主交付为 [vivado-replay.tcl](../results/vivado/2026-09-13-hierarchy-state/vivado-replay.tcl)，一个文件可直接运行；不依赖旁边 JSON、录制器、Node.js 或 API 密钥。在 Vivado 2024.2 中先关闭当前工程，再用 Tools → Run Tcl Script 运行；输出创建在当前工作目录的新 UUID 子目录。已有同名输出会拒绝覆盖，重跑应选择另一个空白工作目录。

此结论仅适用于本次两源码无约束 RTL 样本，不代表所有 Vivado 流程、时序收敛、仿真或硬件通过。VM 的录制器包未更新，当前验证路径仍为 VM 采集、本地分析、VM 执行脚本。

## 首次失败及处理

本轮第一次执行在物理优化之后终止，原生 runme.log 明确写出 “The application has run out of memory”。综合为 100%，实现为 phys_opt_design ERROR / 60%，没有 PASS 标记。保留失败工程和日志，不把它当作 API 失败。

VM 为 16 GB RAM，当时任务管理器显示已提交内存约 15.0/17.0 GB。正常退出本任务 Vivado 后降至约 12.9/17.0 GB，随后从空白 Vivado 启动页运行新隔离脚本。未关闭无关程序、修改虚拟内存/许可证/时间、扩大 VM 或更改设计参数。第二次成功说明干净会话解决了这次运行阻塞，不证明资源问题已永久消除；更早那次 place_design 异常的具体根因仍未获得独立证明。

## 本轮通用修订

按 recorder-adapter、recorder-diagnose、recorder-verify 分层核验，修改的是生成/诊断逻辑，没有手改模型返回或某次 Tcl：

- 新增显式离线导出入口 vivado-focused-replay.mjs：重新核验原始响应、请求、图片摘要、继承上下文、完整最终结构后，才编译到不存在的新目录。
- 付费局部回归入口仍不直接输出脚本。离线导出单独记录程序、脚本和编译器摘要，不覆盖旧响应、旧 failed 状态或旧脚本。
- 原生等待失败保留运行对象、阶段、进度、NEEDS_REFRESH、原生日志位置和等待错误；错误/超时/过期结果仍禁止标为成功。
- 普通分析与修复提示同步允许已提供的控件、接口及登记官方来源 ID，未知知识 ID 仍拒绝。
- 先前修复的顶层视觉事务、运行版本失效和重复查询保留状态，本轮在原生成功路径得到验证。

离线回归 **117/117**：Vivado 62、JMP 55。成功路径在 VM 验证；新错误诊断模板的异常分支为离线测试，不冒充本轮再次触发的原生失败。

## 独立对照

独立基线来自原录制工程，分析前已保存，未输入给模型补答案。

| 检查 | 结果 |
| --- | --- |
| Vivado | 2024.2 英文，SW Build 5239630 |
| 器件 / 语言 | xc7a200tsbg484-1 / Verilog / Mixed，与基线相同 |
| 源码 | parity_leaf.v、parity_top.v 全文逐字一致 |
| 中间顶层 | parity_leaf → parity_top，执行后即时属性断言通过 |
| 综合 | synth_design Complete!，100%，NEEDS_REFRESH=0 |
| 实现 | route_design Complete!，100%，NEEDS_REFRESH=0 |
| 保存重开 | NATIVE_CALLS_AND_REOPEN_PASS |
| 电路 | 1 LUT4，INIT=16'h9669；4 IBUF；1 OBUF；10 nets；5 ports |
| 布线 | 5 个 routable nets 全部完成，0 routing errors |
| 执行文件 | 从 VM 拉回的 Tcl 与发送文件 SHA-256 完全相同 |

原生实现日志仍有缺少时序约束/用户时钟的警告，GUI DRC 也有 critical warnings。本录制没有 XDC；本次不补写约束、不宣称时序、DRC 清零、功耗准确、bitstream 或上板验证。

## API 范围与费用

本轮执行与修复 **0 次新增 API 请求、0 新增 API 费用**。沿用 [此前真实 API 回归](vivado-state-api-test-2026-09-13.md) 的 4 次请求结果，估算约 $0.79，不是账单。

第 12–14 段是该轮真实响应，前 11 段为核验过来源的旧模型上下文，因此 fullyReanalysed=false。并未宣称整个 session 用新提示重新分析。原样响应和 failed 状态不改写，单独保存本地复验及原生执行结果。

## 证据索引

执行脚本 SHA-256：4340e8adba01d35605eacbdbbabd31140e1611398b148716f8846cb2c6c0f67c。

本机项目根目录 .equile-local/vivado-hierarchy-20260912 下保留：

- vivado-state-replay-20260913-clean：受控生成的脚本、程序、来源记录。
- vivado-state-native-20260913-clean：从 VM 拉回的原生读回、calls.log、PASS、源码、布线/资源报告、综合/实现日志。
- vivado-state-native-20260913：第一次内存失败的原生证据。
- independent-gui-baseline.json 及 vivado-hierarchy-verification-e40a6f：独立源工程基线。

发布目录只包含通过验证的独立 Tcl 和脱敏结果摘要；原始录制、截图、请求体、provider 响应和 VM 全量日志不提交。
