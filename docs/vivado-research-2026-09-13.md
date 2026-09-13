# Vivado 后续研究：顶层状态识别与原生布局崩溃（2026-09-13）

## 结论与本轮边界

后续状态：顶层识别修复后的新脚本已完成隔离实机回放和独立对照，详见 [2026-09-13 原生验证](vivado-state-native-verification-2026-09-13.md)。以下保留本阶段的历史失败与研究证据。

本轮沿 recorder-diagnose / recorder-verify 的证据链方法继续调查。**确认了顶层切换被错误省略的识别与校验缺口，但尚未确认布局崩溃的底层原因。** 两者必须分开处理，不能将识别遗漏直接认定为崩溃原因。

- 本轮没有调用付费 API、重新生成 Tcl、修改模型结果、修改生产代码、重跑综合/实现、reset 工程或提交/push。
- 在 VM 中仅执行原生只读查询，并将明确指定的工程设置、实现脚本和日志复制到新的诊断目录；原工程和失败现场保留。
- 本轮新增验证为两个本地合成结构校验探针，不是模型准确率测试，也不是原生回放通过。
- 基线详见 [上一轮真实验证](vivado-hierarchy-verification-2026-09-12.md)。本轮没有改变其中“部分通过”的结论。

代码检查对象：集成工作目录 `.equile-local/vivado-results-publish-checkout`，HEAD `e7390e96cf5ab12269f5a48874f1b3173212acf6`，包含上一轮已存在的未提交修改。本轮保留这些修改。

录制：`bin/vivado-recorder/recordings/20140122-002439-8d8648`。
分析运行：`generated-vivado/e40a6ffcdb194d3aff85d7f0`。
VM2：Vivado 2024.2，SW Build 5239630。VM 时钟仍为 2014 年，没有调整系统时间或许可。

## 一、实现崩溃：已缩小范围，不能宣称根因已解决

### 新取得的独立对比证据

1. 原工程和失败回放工程的 `impl_1/parity_top.tcl`，仅将工程根目录统一后，**全文完全相等**。实现命令和选项没有发现差异。
2. 两份 XPR 的文本差异限于工程路径、工程 ID 和 HDL 存放路径；当前导出文件中未发现器件、语言、顶层、运行策略等设置差异。这不等同于检查了全部进程级环境、缓存或二进制数据。
3. 两份日志的 Vivado 版本/构建号相同。日志中从优化到布局 Phase 2.3 的相应阶段校验值一致：
   - 优化阶段：`2132bab50`；
   - 布局初始化阶段依次包含 `15a88d304`、`1cb783be2`、`228c7160d`；
   - Phase 2.3 均为 `228c7160d`。
4. 原工程继续完成 Phase 2.4、布局和布线；回放在 `Phase 2.4 Global Place Phase1` 后立即记录 `Abnormal program termination (UNKNOWN)`。共同校验值支持“进入该阶段之前未发现明显设计状态差异”，但不是正式网表等价证明。
5. 两边布局日志均使用最多 2 CPUs。失败运行已经成功取得 Implementation/device 许可，布局前 DRC 为 0 errors；日志没有给出内存不足错误。回放已记录的内存峰值约 1956.535 MB，不能据此推算崩溃瞬间可用内存。
6. `hs_err_pid3144.dmp` 实际 **0 字节**，`hs_err_pid3144.log` 只有 124 字节，没有可继续分析的调用栈。
7. 对失败回放根目录下现存文件进行有上限枚举，最长路径为 **202 字符**。导出记录的 83 个条目含 Windows glob 重复匹配，不应当作唯一文件数。这个检查没有覆盖工程外目录，也不能排除某个创建失败而未落盘的路径。

AMD 的 Windows 项目指引提醒 260 字符路径限制，但当前现存路径未超限。因此短路径可以作为后续对照条件，**不能据此将本次故障诊断成路径过长**。[AMD UG895：Creating a Project](https://docs.amd.com/r/2024.2-English/ug895-vivado-system-level-design-entry/Creating-a-Project)

### 当前合理结论

已确认这是目标软件原生布局进程异常终止，不是这一步正在请求 API。现有证据不支持把它直接归因于错误 HDL、缺少实现接口、许可拒绝或已证明的长路径问题；也不足以断定是某个确定的 Vivado 产品 bug、线程问题或 VM 内存问题。

没有手改 Tcl、添加约束、换器件或跳过实现来制造成功。

### 下一步原生诊断实验（本轮未执行）

- 先在新的隔离目录做一次相同设置的原样复测，判断是否可稳定复现；不 reset 或覆盖原失败工程。
- 如仍崩溃，再做单一变量对照，例如仅改变布局线程数。不要同时改路径、线程、策略和约束，否则无法定位原因。
- 每个试验最多一次，保留原始日志、有效转储、配置与终态；崩溃重现即停止该试验，不无限重试。
- 如需诊断安装/VM 环境，先取得有效崩溃信息，再根据确切构建号核对官方问题记录。现有 UNKNOWN 日志不能代替这个证据。
- 这些是诊断试验，不应覆盖原样回放失败的历史结果。即使某个环境设置下成功，也仍需独立结果比对。

## 二、顶层切换遗漏：不是没有上传截图

### 真实请求与最早错误点

第 12 段实际请求含 **12 个输入事件、10 个图片位置**。

| 证据 | 相对 evt-00000132 松键时间 | 作用 |
| --- | --- | --- |
| evt-00000131.jpg | 点击菜单前 | Set as Top 的选择对象及命令 |
| evt-00000132.jpg | +268 ms | 操作后，Sources 仍处于更新状态 |
| evt-00000132-settled-after.jpg | +1401 ms | 延迟观察，仍不能证明界面稳定 |
| evt-00000134.jpg | +21867 ms | 下一次右键之前的稳定树，包含已变化的顶层标识 |

以上文件全部出现在该段请求清单中，包括最后一张较晚的稳定图；不存在为本项证据跨段或漏上传而导致看不到的问题。

对截图的人工核查：后续树中的顶层图标/加粗标识移到了叶模块，但模块的树形位置并未按模型预期重新排列。模型输出却把 evt-00000131/132 标成 `cancelled`，理由是后续树仍显示原模块为顶层；本段 `operations=[]`、`complete=true`、`unresolved=[]`。

**最早可以确认的偏差是 VLM 对顶层状态标识的解释，不是 Tcl 编译器遗漏已存在的接口调用。**

AMD 文档说明 Set as Top 用于显式指定顶层，顶层由对应的模块图标标识；Hierarchy Update 控制对顶层/文件变化的更新行为。不能只根据谁排在树上方判定 top，也不能把暂时 Updating 当作取消。自动模式中“指定 top 找不到后重新选择候选”的行为也不能无条件套用到任意 Set as Top。[AMD UG893：Sources Window Popup Menu Commands](https://docs.amd.com/r/2024.2-English/ug893-vivado-ide/Sources-Window-Popup-Menu-Commands)、[Hierarchy View Icons](https://docs.amd.com/r/2024.2-English/ug893-vivado-ide/Hierarchy-View-Icons)

### 为什么现有链路没纠正它

- 该段 `knowledge.controls` 只有 Hierarchy 标签，语义状态为 `visible_label_only`；`knowledge.commands` 和 sources 为空。
- **并非执行接口缺失**：同一请求的 `nativeApiCatalog` 包含全部 7 个受支持接口，其中有 `set_property` 和 `get_filesets`。
- UI Map 未提供 Set as Top 上下文菜单及顶层图标的具体状态说明。检索只使用事件 target.name、窗口标题、键入文本；本样本没有 UIA 名称，窗口标题自身含 Hierarchy。因此只命中 Hierarchy 不能证明知识库理解了当前菜单操作。
- 采集实现 `CaptureJmpDelayedObservation` 在 JMP/VIVADO 中等待 800 ms，并检查队列/新事件/窗口条件。它不检查 Sources 的 Updating 是否结束；函数注释本身也明确“不证明完成”。本例较晚的下一动作前图足以补证，但模型没有正确利用。
- 提示词已有“settledAfter 不保证稳定”的通用规则，但没有本应用的顶层状态判据。
- `coverage()` 检查 complete/unresolved 一致性；`validateVivadoProgram()` 对 cancelled/navigation 主要检查合法证据引用，并不验证取消结论是否被后续图反驳。
- `mergeVivadoChunks()` 合并各段结果，无法从零操作、全部已决策中发现语义上的错误取消。
- 后续恢复原 top，使最终属性正确，但不能证明中间切换复现。如果产品决定省略无最终贡献的状态切换，也必须明确标为基于状态等价的简化，不能把实际发生的变化错误称为取消。

相关实现：`src/analyzer/lib/vivado-program.mjs`、`vivado-knowledge.mjs`、`src/analyzer/vivado-cli.mjs`、`src/Recorder.Native/Recorder.cs`。

## 三、额外确认的状态管理隐患（非本次崩溃根因）

本轮以合成数据直接调用当前校验器，未调用模型、未操作原生工程：

1. 一个只给出文字理由、没有可验证取消结论的 cancelled 决策，仍可通过最终结构校验。这与真实第 12 段被接受的行为一致。
2. 合成序列“综合完成 → 修改 top → 启动并等待实现”，没有重新综合，也通过校验；返回目录仍将 synth_1 和 impl_1 都标为 completed。

第二项证明当前运行状态没有绑定输入修订版本。它是后续支持多次 top/源码变化时必须修补的漏洞。**本次实际生成 Tcl 的 top 设置发生在综合之前，因此不能用这项合成结果解释当前布局崩溃。**

这两个探针证明的是本地结构校验覆盖边界，不代表真实 VLM 失败率，也没有证明 Vivado 会执行出同样的旧结果。

## 四、建议的通用修复顺序（尚未实现）

1. **补状态语义**：在 UI Map 中加入 Sources 上下文菜单、Set as Top、顶层图标、更新中状态及官方来源。地图事实和实测位置仍分离，不写死本样本的名字或坐标。
2. **建立状态事务**：记录“对哪个文件集/模块发起切换 → 更新中 → 后续稳定状态确认”，保留触发事件与确认图片的不同归属。pending 不能自动变成 cancelled。
3. **补反证检查**：cancelled/no-effect 需要取消或前后状态相同的可检查依据；存在相反后图时标 unresolved 或进入有预算的复核，不以补齐决策数量代表完整识别。
4. **按输入版本管理运行**：top、HDL 或其他影响综合的设置变化，令相关已完成运行失效；实现必须依赖同一输入版本下有效的综合。具体变化仍需由模型选择受支持接口，不由宿主硬猜命令。
5. **证据预算保持小**：优先将同一事务的菜单前图、Updating 状态和后续稳定 Sources 区域组合给模型，同时保留必要全图、时间和裁剪映射；不必因这一处漏判重传全部 session。
6. **先本地回归，再付费复核**：至少覆盖 UIA 关闭、更新超过延迟窗口、顶层图标改变但树位置未重排、切换后恢复、跨段确认、综合后改变 top 六类样例。
7. 若以后只重分析第 12 段及受其对象/状态影响的后续段，应先实现可审计的依赖失效与缓存复用规则。当前身份校验会因代码/提示变化拒绝旧检查点，不能绕过它直接拼旧结果。

## 本地证据位置

- 新研究导出：`.equile-local/vivado-hierarchy-20260912/vivado-research-20260913/`
  - original/replay-implementation.tcl
  - original-implementation.log
  - original/replay-project.xpr
  - path-and-crash-audit.txt
- 上一轮原样执行证据：`.equile-local/vivado-hierarchy-20260912/vivado-hierarchy-verification-e40a6f/`
- 实际输入/模型输出：上述 generated 目录的 `012-1789279807995-request.json` 与 `012-1789279807995-parsed.json`。
- 原始图片保留在录制目录 screenshots；没有复制进公共测试夹具或上传到 Git。
