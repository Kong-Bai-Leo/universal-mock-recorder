# Quartus UI Map · 26.1.1 Pro · 英文界面

这是一版供 AI 按操作上下文检索的本地知识库：记录控件名称、父子关系、参数角色、中英文别名及依据。它已接入 `src/analyzer/quartus-cli.mjs` 的分段分析链路：每段选择有限节点，再把相关知识与录制证据提供给配置的模型 API。该接入已通过离线测试，真实 API 识别尚未验收。

路线保持为：**截图和鼠标/键盘证据 → 外部模型 API 分析并参考 UI Map → 结构化 JSON → 官方软件接口构建原生工程 → 比较实际结果**。Codex/Spark 用于开发，运行时分析仍使用用户选择的模型 API。

## UI Map 建立阶段的结果

| 内容 | 结果 |
| --- | --- |
| 分区 / 语义节点 | 18 / 287 |
| 现场可见 / 仅文档节点 | 271 / 16 |
| 现场截图 / 官方资料 | 24 / 14 |
| 自动检查 | 结构、引用、截图 SHA-256、尺寸与实际编码通过；17 项测试通过 |
| 扫描阶段的业务动作、模型分析、工程复原 | 未执行；不以此表表示后续构建器验收状态 |

About 实机观察版本为 **26.1.1 Build 130 08/06/2026 SC Pro Edition**。建立此地图时，新建向导在 Finish 前取消，Platform Designer 在启动窗口退出，最终回到原 Quartus 首页；该扫描没有创建工程、编译或烧录。后续录制器及构建器的独立验收见源码仓库 `docs/quartus-recorder-status-2026-09-07.md`，不追溯修改地图节点的历史观察状态。

## 覆盖范围

现场覆盖首页、About、File/Edit/View/Project/Assignments/Processing/Tools/Window/Help 的第一层菜单、空工程向导各页，以及 Platform Designer 启动说明、Open System 的 System/IP Variant/BSP Editor 页签与退出确认。

向导实际顺序是 Introduction → Directory, Name, Top-Level Entity → Family, Device & Board Settings → Add Files → EDA Tool Settings → Summary。**器件页在添加文件页之前**。工程名称、顶层实体、工作目录分别建模；探测时输入的临时名称不会成为默认值。

Platform Designer 系统编辑、参数、连接、地址、时钟和复位另有文档知识分区。正文支持的 Address Map、Generate HDL 保留文档标签；只核对目录主题的条目使用概念节点和空 `visibleLabel`。被启动窗口遮挡的编辑区没有标为现场观察。

未展开嵌套子菜单；未扫描工程设置内部、Pin Planner 编辑区、各 IP 参数、端口连接与地址/时钟/复位编辑、许可证和硬件功能。未确认的工具栏图标不纳入确定名称库。这不是整个 Quartus 的完整覆盖。

## 文件与来源

- [ui-index.json](ui-index.json)：分区入口与限制。
- 各分区 `ui-map.json`：语义节点与层级。
- [sources.json](sources.json)：官方地址、文档版本、日期与阅读范围。阅读目录不等于已读整本手册。
- [live-observation.json](live-observation.json)：历史状态、控件转录、截图路径、时间与校验值。
- [verification-report.json](verification-report.json)：结构和证据完整性报告。
- [retrieval-examples.json](retrieval-examples.json)：本地检索示例，属于候选检索，不是模型分析结果。

官网入口：[Quartus Help 25.1.1](https://resources.altera.com/quartushelp/25.1.1/index.htm)、[Getting Started](https://docs.altera.com/r/docs/683463/current)、[Platform Designer](https://docs.altera.com/r/docs/683609/current)。部分资料早于安装版本，来源表保留差异。

截图仅存本机 `.equile-local/quartus-uimap-2026-09-07/evidence/`，相对仓库根目录定位。若要重新执行原图哈希与编码审计，需要迁移该证据目录；普通运行时知识检索只依赖地图和证据元数据，工具包不分发这些原图。实际 JPEG 使用 `.jpg` 副本，与原捕获字节相同，没有转换图像。

## 检索方法

在仓库根目录使用下列模块：

```js
import {loadQuartusKnowledge, retrieveQuartusKnowledge}
  from './src/analyzer/lib/quartus-knowledge.mjs';
const knowledge = await loadQuartusKnowledge('ui-maps/quartus/26.1.1-pro/en-US');
const context = retrieveQuartusKnowledge(
  knowledge,
  [{observedText: '新建工程 顶层实体'}],
  {application: 'quartus', sectionId: 'new-project-wizard'},
  24
);
```

默认最多返回 24 个节点，节点上限 100，序列化上下文上限 64 KiB，超限明确报告截断。返回父链、角色、来源版本和截图元数据，不自动加载或上传 UI Map 原图。分析入口另设请求、录制截图、输出 token 和文本上下文预算。确定性分词检索只给出候选，不能替代视觉识别；未命中和歧义分别报告。

本地进程识别仅接受 `quartus`。独立检索可由已确认的目标上下文提供 `application: 'quartus'`；实际录制器必须运行在远程 Windows 内，以真实 Quartus 进程标记事件。不会将任意 `mstsc` 窗口视为 Quartus，检索模块也不负责远程窗口识别。

`verification` 区分现场可见和仅文档。所有业务动作的 `behaviorVerification` 均为 `not_executed`：浏览菜单不代表其业务动作已验证。历史截图中的数值、灰显状态不是当前状态；截断或标点不确定标签使用 `observed_partial`。

## 本地复核

```text
node --test tests/quartus-knowledge.test.mjs
node scripts/test-quartus-ui-map.mjs --evidence --write-report
```

这些检查不能证明 AI 理解操作正确或工程还原成功。后续链路已有录制器、API 分析入口、结构化 JSON 校验及受控 Tcl 构建器；真实录制经 API 分析后在 Quartus 还原并比较结果，仍是独立的端到端验收。

后续独立构建样本已在同一远程 Quartus 中实际创建原生工程并完成完整编译：消息 21793，0 错误、13 警告，耗时 3 分 38 秒。该样本未指定引脚/IO 标准、未生成烧录文件，时序无约束，逻辑等价未验证；真实 API 分析因缺可用密钥未测，最终原生回读及编译报告已完成 16/16 检查：7 项回读检查通过，HDL 内容与生成输入完全一致。相关离线批次为 102/102，扩大批次为 121/122（1 项既有 PSCAD PLAN 模板测试不匹配）。这些结果属于录制/构建链路的独立验收，不把地图中所有节点的历史 `behaviorVerification` 升级为已执行。
