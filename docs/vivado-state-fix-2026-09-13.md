# Vivado 顶层状态修复与局部 API 测试（2026-09-13）

## 当前结论

后续更新：隔离原生回放及独立对照已通过，见 [原生验证记录](vivado-state-native-verification-2026-09-13.md)。本文保留当时 API/修复阶段的历史状态与计数。

本文记录首次修复及当时等待授权的阶段。用户随后明确授权，已完成 4 次真实 API 请求，并修复本地知识引用和重复查询校验。第 12–14 段原样响应现已通过本地复验，114 项回归通过；费用约 $0.79。详见 [后续 API 回归记录](vivado-state-api-test-2026-09-13.md)。以下准备信息与测试计数属于授权前快照。

本次局部顶层切换已按实际图片核查，但没有重跑 VM 或解决原生 place_design 崩溃。原录制、旧模型响应、旧 Tcl、原工程和失败回放现场均未修改；没有 commit/push。

## 已实现

- UI Map 新增独立 sources-state 分区，三条文档知识：Sources 右键菜单、Set as Top、Top module icon；明确父子关系和官方来源，无固定坐标，无 AutomationID。总计 203 条，不宣称完整扫描。参照 [AMD Sources Popup](https://docs.amd.com/r/2024.2-English/ug893-vivado-ide/Sources-Window-Popup-Menu-Commands) 与 [Hierarchy Icons](https://docs.amd.com/r/2024.2-English/ug893-vivado-ide/Hierarchy-View-Icons)。
- UIA 关闭时仍会给模型一个小型状态知识包。它只提供候选说明，不证明按钮被点击。
- JSON 升级为 vivado-native-plan-2，加入 topTransactions。模型必须表达前/后模块身份、稳定性、图标或显式摘要字段、实际图片引用、原始触发事件、提交/取消/未完成状态和对应 top 接口调用。
- Updating 不得当作完成；树顺序/缩进/高亮不得替代顶层标识。允许下一次操作的 before 图确认前一事务，跨段保留 pending，并引用原始触发事件完成续接。
- 校验图片引用属于实际证据、时间不早于触发、调用值/接收对象匹配，以及“已提交”与“取消/导航”不能矛盾。**这检查的是证据结构与一致性，不是宿主已经验证了模型对像素的判断。**
- 设计源、sources_1 top、target_language 变动使已完成综合/实现过期；改回旧值也不恢复旧运行的有效性。运行期间改设计会被拒绝。
- 生成器增加实现前的综合终态/NEEDS_REFRESH 保护，以及重开后的运行新鲜度检查。未开放自动 reset/rebuild；遇到该范围应报告未支持，不默默重用过期结果。新原生保护尚未实机验证。
- 新增独立的局部 API 回归入口 vivado-focused-test.mjs。旧响应只作明确标注的上下文，核对原始响应与解析结果、输入、图片哈希、原配置、连续上下文来源；涉及旧 top/运行语义的前缀拒绝直接继承。**此入口不输出 Tcl，也不发布整段已重新分析的结论。**
- 原有完整分析与离线重编译依旧要求当前契约匹配，不绕过旧缓存失效。普通分析请求预算保持不变。

结构化输出遵循 OpenAI 的封闭字段/必填 schema 约束；结构符合并不等于语义正确，仍保留本地检查与独立视觉/原生验证。[OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)

## 验证范围

集成目录：.equile-local/vivado-results-publish-checkout；修订也同步到主工作目录相同文件，保留其他既有修改。

- Vivado：49 项离线检查通过（原测试、顶层状态、运行失效、知识检索及局部回归保护）。
- JMP：55 项回归通过，未修改 JMP 实现。
- 合计：104 项。本轮新增检查使用合成数据，不代表真实模型准确率。
- 没有手改旧 generated 文件，没有生成新的可运行 Tcl，没有更新 VM 内旧包。

## 已准备的真实 API 测试

录制：bin/vivado-recorder/recordings/20140122-002439-8d8648。
旧分析：generated-vivado/e40a6ffcdb194d3aff85d7f0。

| 分段 | 输入事件 | 上传图片位置 |
| --- | ---: | ---: |
| 12 | 12 | 10 |
| 13 | 12 | 12 |
| 14 | 5 | 5 |
| 合计 | 29 | 27 |

前 11 段仅提供经来源核验的必要旧模型上下文，不重新上传其图片；不使用原生工程真值或人工填写答案。沿用 gpt-5.6、low reasoning、high image detail。最多 4 次请求，最多一次语义修复，网络自动重试为零，失败保留证据并停止。

本地准备报告：
bin/vivado-recorder/recordings/20140122-002439-8d8648/generated-vivado/_focused-tests/bd8e5c4fc5cddf291ddb3d2a/prepare.json。

当时等待明确上传授权；后续授权、实际 provider 响应、usage、topTransactions 与原截图核查均见上方链接，不以 complete=true 代替实机验证。
