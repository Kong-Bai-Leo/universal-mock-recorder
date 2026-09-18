# Vivado 多文件/顶层切换录制验证（2026-09-12）

## 结论

后续状态：顶层识别修复后的新脚本已完成隔离实机回放和独立对照，详见 [2026-09-13 原生验证](vivado-state-native-verification-2026-09-13.md)。以下保留本阶段的历史失败与研究证据。

**本轮部分通过，不是完整还原通过。** 真实录制已完成 14 段 API 分析并自动生成独立 Tcl；原样在 VM 中执行一次后，两份 HDL 内容、源列表、最终顶层、工程配置及综合状态与原工程一致。但回放的实现运行在 `place_design` 阶段异常退出，未完成布线、自动关闭/重开和末尾检查。

另有独立的识别缺口：模型漏掉了中途将 `parity_leaf` 设为顶层的已提交变化。最终 `parity_top` 设置正确，不等于顶层切换全过程正确。这两个问题分别属于原生运行失败与分析状态识别，不能合并归因。

本报告是 agent 根据原生读回和录制证据编写的验证记录，不是生成脚本自身的 PASS 文件；没有改写模型 JSON 或输出 Tcl。

## 样本、隔离和证据来源

- 环境：VM2，Vivado 2024.2 英文版。VM 时钟为 2014 年，未调整时间或许可；本文日期是本地任务日期。
- 录制：`bin/vivado-recorder/recordings/20140122-002439-8d8648`；153 个事件、190 张源图片、150 个唯一图片内容、151 个请求图片位置，共 14 段。
- 事件和截图来自 VM 内的 Vivado 会话，不是外层远程桌面；本样本不靠按钮 AutomationID。
- 原工程：VM 的 `C:/Users/user/VivadoHierarchy_20260912_C/VivadoHierarchy_20260912_C.xpr`。
- 回放目录：VM 的 `C:/Users/user/AppData/Roaming/Xilinx/Vivado/VivadoReplay-332daf61-24fb-439d-af77-7ac70102d80f`；工程在其 `project` 子目录中。
- 原工程的源码/运行/网表读回及本地独立 GUI 基线均在 API 前获得，放在验证侧，**没有发送给模型补答案**。
- 两份源码在录制画面中完整可见。保留了模板输入、错误输入及修正、保存、切换 top、综合与实现的原始过程；没有重录成更容易通过的样本。
- 原样执行一次；失败后没有 reset、删除工程、修改脚本或悄悄重跑。原工程和失败回放工程均保留。

生成目录：

`bin/vivado-recorder/recordings/20140122-002439-8d8648/generated-vivado/e40a6ffcdb194d3aff85d7f0`

主交付 `vivado-replay.tcl` 自动嵌入两份 HDL，无需旁边的 JSON、录制图片、Node.js 或 API 密钥；但当前这次实机运行未通过，不能作为已验证成功的交付。

本地生成文件与从 VM 拉回的实际执行文件 SHA-256 完全一致：

`F505C2CF163DABA13CBAC8847B953BA72F05C6D1ACA3ED45E4126209145F109D`

## 独立结果对比

| 检查项 | 原工程 | 原样脚本回放 | 结论 |
| --- | --- | --- | --- |
| 工程名 | VivadoHierarchy_20260912_C | 同左 | 一致 |
| 器件 | xc7a200tsbg484-1 | 同左 | 一致 |
| 语言 | Verilog / Mixed | 同左 | 一致 |
| 源列表 | parity_leaf.v、parity_top.v | 同左，无额外源 | 一致 |
| 两份 HDL 全文 | 原生读取 | 原生读取逐份文本比较 | 两份均相等 |
| 最终顶层 | parity_top | parity_top | 一致 |
| 约束列表 | 空 | 空 | 一致，不代表约束支持 |
| synth_1 | synth_design Complete! / 100% | 同左 | 状态一致，综合成功 |
| impl_1 | route_design Complete! / 100% | place_design ERROR / 40% | 不一致 |
| 布线结果 | 5 条可布线网络全部布线，错误 0 | 未进入成功布线终态 | 未还原 |
| 脚本末尾重开检查 | 不适用 | 失败提前退出，未执行 | 未测试 |
| 中途显式 top 切换 | parity_leaf → parity_top | 仅保留最终 parity_top 设置 | 过程有遗漏 |

原生对比实际打印：

`project 1 top 1 constraints 1 sourceNames 1 sourceContent {parity_leaf.v 1 parity_top.v 1} runs {synth_1 1 impl_1 0}`

回放综合日志记录 1 个 LUT4、4 个 IBUF、1 个 OBUF，综合无错误、无 critical warning；一项 warning 为 `Synth 8-7080 Parallel synthesis criteria is not met`。没有将这一 warning 判为综合失败。原工程实现网表读回包含 1 个 LUT4（INIT 为 `16'h9669`）、10 nets、5 ports；由于回放实现失败，**没有宣称实现网表、路由或时序等价**。

## 原生实现失败

回放 `impl_1/runme.log` 第 260 行附近：

```text
Phase 2.4 Global Place Phase1
Abnormal program termination (UNKNOWN)
```

对应 `hs_err_pid3144.log` 仅记录 unexpected error / UNKNOWN，并提示没有文本 stack trace，需要 dump 才能继续定位。已有日志不足以确定根因，也没有证据将其断定为 API 服务、源码语法、路径权限、内存不足或确定的 Vivado 产品缺陷。

脚本 `calls.log` 记录 13 个接口调用条目，最后一个是实现的 `wait_on_runs`，随后记录：

`FAILED: ERROR: [Common 17-39] 'wait_on_runs' failed due to earlier errors.`

脚本正确传播失败；没有输出 `VIVADO_REPLAY_PASS`，也没有生成成功用的 `verification-status.txt`。因此不能用“JSON complete=true”或“已生成 Tcl”替代实机验收。

下一轮应先保留本轮失败样本，在另一个隔离目录安排有界对照，调查原生布局崩溃；不要通过取消实现、改用原工程产物或伪造 PASS 来回避失败。若测试不同路径或线程配置，必须单独标为诊断变体，不能当作本脚本原样通过。

## 顶层切换识别缺口

- 第 12 段模型结果将 `evt-00000131/evt-00000132` 的 Set as Top 判为 `cancelled`，理由是后续树仍显示 parity_top 在上层；该段 operations 为空、complete=true。
- 原始画面中菜单在子模块上调用 Set as Top。即时 after/settled-after 含 Sources Updating 中间状态；后续 `evt-00000134.jpg` 中子模块条目加粗，父条目不再加粗，不能仅以树中父子位置认定 top 未变化。
- 第 13 段随后生成了设置 `parity_top` 的操作，最终 top 正确。
- 所需画面已经包含在实际发送的第 12 段证据中；这是状态解释不足，不能归因为“图片没上传”。
- 基于这些截图与 API 前独立 GUI 观察，本轮不能宣称 leaf→top 切换复现通过；也不能把最终属性相等当成中间步骤无意义的充分证据。

建议后续在通用 harness/UI 知识中区分选择高亮、加粗 top 标识和 Sources Updating，等待稳定后图，跨段保留属性变更；相互冲突时记为未确定而不是强行 cancelled。应增加“树位置不变但 top 标识改变”回归；不要硬编码此工程名或直接补写本次 Tcl。

## API 与成本边界

用户批准总上限 16 次请求尝试（包括失败和重试）。实际：

- 总尝试 15：一次本地 EACCES 连接失败，14 次取得有效模型结果；14/14 段完成。
- 请求配置 gpt-5.6、low reasoning、high 图片；响应报告模型 gpt-5.6-sol。
- 输入 tokens 531,647，其中缓存输入 22,126；输出 13,378；总计 545,025。缓存输入已包含在输入中，不能再次相加。
- 美元金额未取得可靠供应商账单，记为未知，不填 0。
- 图片位置按分段为 12/11/11/12/11/11/10/11/12/12/11/10/12/5。每段携带之前上下文，因此累计 token 不等于唯一图片数量。
- 分析完成后未再请求 API、未使用剩余一次预算尝试。
- 采集时间异常提示 evt-00000072、evt-00000105 保留，不隐藏晚采集风险。

## 本地证据及验证范围

原生证据已通过远程桌面文件复制拉回：

`.equile-local/vivado-hierarchy-20260912/vivado-hierarchy-verification-e40a6f/`

内含 `source-replay-audit.txt`、API 前的两份 source audit、`calls.log`、综合/实现日志、崩溃文本、两份实际源文件及实际执行 Tcl。未拷贝可能很大的 crash dump；未输出或上传密钥。对比审计 SHA-256：

`ED66E8B735AEF6E44E5021FEA687DB05F82525DD8A1DD6DF932890DCBE5A7E3A`

本轮 Vivado 离线回归再次运行 **31/31 通过**，但这不能覆盖本次原生布局异常和 top 视觉识别错误。上一轮 JMP 55/55 是此前结果，不标成本轮重跑。

本轮没有生产逻辑修复、没有手改生成结果、没有 commit/push。既有单源码通过记录仍保留，见 [上一轮 HDL 验证](vivado-hdl-verification-2026-09-12.md)。本轮不扩展为 XDC、IP、仿真、bitstream、硬件、全器件或全许可验证。
