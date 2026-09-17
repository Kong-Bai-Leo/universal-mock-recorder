# ANSYS Mechanical / HFSS Recorder 适配：官方脚本入口研究

日期：2026-09-16。本文保留最初的**只读文档研究**及其假设；最新环境检查与单文件路径修订见下一节。未生成或运行 ANSYS 回放脚本，未调用求解器，未验证 ANSYS 真实录制；组件目录或启动画面不等于所需功能已获许可。

## 后续实机检查与单文件路径修订

- VM2 已实际启动 `C:/Program Files/ANSYS Inc/v252/Framework/bin/Win64/RunWB2.exe`，启动画面为 Ansys 2025 R2。但空白 Workbench 弹出无法连接有效许可服务器的错误，工具箱没有适用条目。HFSS 此前缺少所需许可 feature；两条路线均未通过许可门槛。详见 [实机进度记录](orcad-ansys-progress-2026-09-16.md)。未修改许可设置或用户工程。
- 修订此前“单文件几何路径仍未知”的结论：官方 2025 R2 文档支持候选路径 **一份 `.wbjn` → Static Structural 系统 → DesignModeler 内嵌 JScript → Mechanical 内嵌 Python**。这是把多个官方接口组合后的工程方案，尚非完整跨容器实测结果，也不是直接运行 ACT 扩展回调。
- 外层使用 `GetTemplate(TemplateName="Static Structural", Solver="ANSYS").CreateSystem()` 建系统；官方示例确认此入口，但该示例本身不是本项目端到端样本。[Workbench 官方示例](https://ansyshelp.ansys.com/public/Views/Secured/corp/v252/en/wb2_js/wb2js_example3.html)。
- Geometry 容器支持 `Edit(IsSpaceClaimGeometry=False, Interactive=False)` 和 `SendCommand(Command=内嵌脚本, Language="Javascript")`。DesignModeler 普通 JScript 提供闭合矩形草图和 `agb.Extrude(...)`；`agb.Regen()` 后由容器 `Exit()` 更新并保存其内部几何数据库。因此不必把外部样例几何列作必需输入，但具体单位、更新顺序和无界面执行仍须本机验证。[Geometry 容器](https://ansyshelp.ansys.com/public/Views/Secured/corp/v252/en/wb2_js/ContainerName56.html)、[草图示例](https://ansyshelp.ansys.com/public/Views/Secured/corp/v252/en/wb_dm/dmScriptFeaExample.html)、[Extrude](https://ansyshelp.ansys.com/public/Views/Secured/corp/v252/en/wb_dm/dmScriptExtrude.html)。
- Mechanical 容器可发送 Python；先打开编辑器并复用会话，避免依赖 GUI 的命令在未打开编辑器时失效。官方静力示例覆盖支撑、载荷、网格、求解和结果读回；面选择应按几何位置建立命名选择并断言唯一性/面积/方向，不复制示例面 ID。[Mechanical 容器](https://ansyshelp.ansys.com/public/Views/Secured/corp/v252/en/wb2_js/ContainerName32.html)、[2025 R2 静力示例](https://ansyshelp.ansys.com/public/Views/Secured/corp/v252/en/act_script/act_script_demo_static_struct.html)、[位置选面](https://ansyshelp.ansys.com/public/Views/Secured/corp/v252/en/act_script/act_script_examples_create_named_selection_faces.html)。
- 许可可用后的最小候选测试：隔离空白工程中创建有明确尺寸的矩形拉伸体，分别选择两端面固定/施力，生成网格并求解，对照几何、载荷、总变形和反力，再保存重开。测试尺寸是测试输入，不是识别逻辑中的硬编码。只有与真实录制独立对照后，才能标为 Recorder 端到端通过。
- “单文件”指唯一交付输入；Workbench 运行时生成 `.wbpj`、几何数据库、求解文件等正常输出，不承诺整个工作目录只有一个文件。许可阻塞未解除前不发 ANSYS 模型请求，不把文档候选或安装目录算作通过。

## 适配边界与 MVP 选择

把 Mechanical（结构仿真）、Workbench（项目系统与集成容器）、Electronics Desktop 中的 HFSS（电磁设计）视为不同产品/设计类型与回放后端。仅在确认目标可执行文件、产品版本、设计类型和许可证后，才为其标注“实机可运行”。脚本入口属于**回放**，不能据此推断 Recorder 采集阶段读取过模型内部对象。模型选择应由有来源的命名选择、对象属性和几何断言保护；不得把屏幕上看到的面编号当成运行时拓扑 ID。

推荐先以 **HFSS 3D、2025 R2 IronPython 单文件 `.py`** 做“创建少量几何 → 读回并断言 → 保存隔离 `.aedt`”的最小原生 API 回放；它的项目、设计与基本 3D Modeler 对象均有同一脚本入口。求解、端口和 S 参数另列下一层，不把单个 box 的创建算作可求解模型。若实际只有 Mechanical 可用，则先做其受控项目/设置的 Python 宏回放，但**不要声称已满足从空白环境以单文件完成几何、设置和求解**：Mechanical 的常见官方示例均先附加单独的 `.agdb`/`.x_t` 几何，完整单文件方案仍需核实支持的几何创建途径。[HFSS 运行脚本](https://ansyshelp.ansys.com/public/Views/Secured/Electronics/v252/en/Subsystems/HFSS/Subsystems/HFSS%20Scripting/Content/RunningaScript.htm)；[Mechanical 静力示例及其几何前置](https://ansyshelp.ansys.com/public/Views/Secured/corp/v251/en/act_script/act_script_demo_static_struct.html)。

这里的“单文件”指交付给目标应用执行的一份脚本，不要求用户手动准备另一个样例项目。程序依赖目标产品、合法许可证和受控输出目录不算脚本文件，但如果脚本需要另一个预制几何/项目文件，必须明确标为**非单文件端到端**。不应以随安装可能提供的样例文件充当无条件可用的隐藏前置。

## Mechanical 与 Workbench

| 范围 | 官方入口与语言 | 适配注意 |
| --- | --- | --- |
| Mechanical 2025 R2 独立模式 | `AnsysWBU.exe -DSApplet -AppModeMech -b -script "<script.py>"`；`-script` 从文件运行 Python，`-b` 批处理，`-x` 自动退出；`-file` 可打开 Mechanical 数据库或导入几何，且必须放最后。 | 官方 2025 R2 页面示例路径仍写 `v241`，不能照抄为 VM2 安装位置。先探测实际版本/路径，不覆盖用户项目。`-file` 引入外部几何/数据库时，不再是零外部输入的单文件流程。[2025 R2 Mechanical 命令行](https://ansyshelp.ansys.com/public/Views/Secured/corp/v252/en/wb_sim/ds_Define_Analysis_Type_step.html) |
| Mechanical 2026 R1 | 仍支持上列 Python 文件入口；新增 `-engineType "cpython"` 或 `"ironpython"`，默认 IronPython。 | CPython 3.x 是 2026 R1 新增，**不要推定 2025 R2 可用**。[2026 R1 命令行](https://ansyshelp.ansys.com/public/Views/Secured/corp/v261/en/wb_sim/ds_Define_Analysis_Type_step.html)；[2026 R1 发布说明](https://ansyshelp.ansys.com/public/Views/Secured/corp/v261/en/pdf/Ansys_Release_Notes.pdf) |
| Workbench 2025 R2 外层项目 | `runwb2 -B -R <journal-or-script>`：批处理回放 Workbench journal/script 后退出。Mechanical 容器 `SendCommand` 可发送 JScript 或 Python，默认 `Language` 为 `Javascript`。 | Workbench journal 不能假定完整记录 Mechanical 内部的每个操作。Mechanical 编辑器未打开时 `SendCommand` 可能无 GUI，部分命令会失败；以隔离流程验证。[Workbench Scripting Guide](https://ansyshelp.ansys.com/public/Views/Secured/corp/v252/en/pdf/Workbench_Scripting_Guide.pdf)；[Mechanical 容器 SendCommand](https://ansyshelp.ansys.com/public/Views/Secured/corp/v252/en/wb2_js/ContainerName32.html) |

Mechanical 的有证据 API 最小切面：在**已存在分析与已导入几何**的项目中，官方静力示例用 `Model.Analyses[0]`、`Solution.AddTotalDeformation()`、`Solution.Solve(True)`、结果的 `Maximum.Value`；官方负载示例用 `AddFixedSupport()` 并给出 `Location` 的几何选择。示例并不证明从零创建几何的同一 Mechanical 脚本方案，也不证明可以按某个硬编码面 ID 安全复现任何录制。[Mechanical 静力示例](https://ansyshelp.ansys.com/public/Views/Secured/corp/v251/en/act_script/act_script_demo_static_struct.html)；[添加载荷/支撑](https://ansyshelp.ansys.com/public/Views/Secured/corp/v252/en/act_script/MechAPIsLoad.html)。

Mechanical 下一步验证应分级：先单文件在独立空白项目检查脚本入口、Python 引擎和可读状态；如目标要求真正端到端，再核实 Mechanical/Workbench/DesignModeler/SpaceClaim 中可由**同一交付脚本**创建或内嵌导入几何的官方支持路径，并验证该路径不会依赖外部样例或编辑器 GUI。只有这一步成立，才继续载荷、网格、求解与结果。若所需功能实际属于 DesignModeler 扩展回调，不应移植为普通 Mechanical 宏调用。[DesignModeler ACT 几何功能上下文](https://ansyshelp.ansys.com/public/Views/Secured/corp/v252/en/act_cust_dm/actdev_cap_dm_geompython.html)。

## Electronics Desktop / HFSS 3D

2025 R2 的 HFSS 脚本入口是 Electronics Desktop 的 **IronPython `.py`**：界面 `Tools > Run Script`，命令行 `ansysedt.exe -RunScriptAndExit <script.py>`（或 `-RunScript` 保持应用开启）；`-ScriptArgs` 对 Python 作为一个未经拆分的字符串提供。2025 R2 文档称 AEDT 已不直接支持 VBScript/JavaScript；旧脚本可经 Python 兼容调用，但不应作为本适配的原生新目标。2025 R1 曾允许录制 `.py` 或 `.vbs`，因此版本判定不可省略。外部 standalone IronPython 仅完整支持 COM 方法，首选由 AEDT 执行脚本。`-ng` 非图形模式与 `-RunScriptAndExit` 的可用组合、Student 许可行为必须本机单独验证，不能仅从 `-BatchExtract` 等其他命令推断。[2025 R2 运行脚本](https://ansyshelp.ansys.com/public/Views/Secured/Electronics/v252/en/Subsystems/HFSS/Subsystems/HFSS%20Scripting/Content/RunningaScript.htm)；[AEDT 命令行](https://ansyshelp.ansys.com/public/Views/Secured/Electronics/v252/en/Subsystems/HFSS3DLayout/Content/GettingStarted/RunningANSYSElectronicsDesktopfromacommandline.htm)（此页是通用 AEDT 启动选项，**不是** 3D HFSS 几何/求解参数依据）；[VBScript/JavaScript 兼容说明](https://ansyshelp.ansys.com/public/Views/Secured/Electronics/v252/en/Subsystems/Mechanical/Subsystems/Mechanical%20Scripting/Content/ScriptingusingEmbeddedVBScriptorJavaScript.htm)（该页位于 AEDT 的 Mechanical 设计文档下，只用于确认 AEDT 脚本语言变化）；[2025 R1 录制格式](https://ansyshelp.ansys.com/public/Views/Secured/Electronics/v251/en/Subsystems/HFSS/Subsystems/HFSS%20Scripting/Content/RecordingaScript.htm)；[standalone IronPython 限制](https://ansyshelp.ansys.com/public/Views/Secured/Electronics/v252/en/PDFs/HFSSScriptingGuide.pdf)。

已核实属于 **HFSS 3D 脚本指南** 的接口（文档存在不等于 VM2 已实机可用）：

| 能力 | 具体接口与输入/输出 | 官方文档 |
| --- | --- | --- |
| 新建 HFSS 设计 | `oProject.InsertDesign('HFSS', name, 'DrivenModal', '')`；方案类型还列有 `DrivenTerminal`、`Eigenmode`。 | [InsertDesign](https://ansyshelp.ansys.com/public/Views/Secured/Electronics/v252/en/Subsystems/HFSS/Subsystems/HFSS%20Scripting/Content/InsertDesign.htm) |
| 几何 | `oDesign.SetActiveEditor('3D Modeler')` 后用 `oEditor.CreateBox(parameters, attributes)`，坐标和尺寸用显式单位字符串。 | [CreateBox](https://ansyshelp.ansys.com/public/Views/Secured/Electronics/v252/en/Subsystems/HFSS/Subsystems/HFSS%20Scripting/Content/CreateBox.htm) |
| 几何独立读回 | `GetObjectsInGroup('Solids')` 得名称，`GetObjectVolume(name)` 得体积，`GetModelBoundingBox()` 得全局坐标系中的六个界限（模型单位）。体积、包围盒应按容差、单位与对象数量分别断言。 | [GetObjectsInGroup](https://ansyshelp.ansys.com/public/Views/Secured/Electronics/v252/en/Subsystems/HFSS/Subsystems/HFSS%20Scripting/Content/GetObjectsInGroup.htm)；[GetObjectVolume](https://ansyshelp.ansys.com/public/Views/Secured/Electronics/v252/en/Subsystems/HFSS/Subsystems/HFSS%20Scripting/Content/GetObjectVolume.htm)；[GetModelBoundingBox](https://ansyshelp.ansys.com/public/Views/Secured/Electronics/v252/en/Subsystems/HFSS/Subsystems/HFSS%20Scripting/Content/GetModelBoundingBox.htm) |
| 分析设置 | `oDesign.GetModule('AnalysisSetup').InsertSetup(setupType, attributes)`；3D HFSS 页展示 `HfssDriven`、`Frequency:=`、`MaxDeltaS:=`、`MaximumPasses:=` 等。**不同解算类型/版本属性不同，需按所选设计类型核对或记录当前版本的一份基线脚本，再受控编译；不能盲拷页面混合示例。** | [HFSS 3D InsertSetup](https://ansyshelp.ansys.com/public/Views/Secured/Electronics/v252/en/Subsystems/HFSS/Subsystems/HFSS%20Scripting/Content/InsertSetup.htm) |
| 保存 | `oProject.SaveAs(fullPath, False)` 可禁止覆盖已有 `.aedt`；输出路径应隔离。 | [SaveAs](https://ansyshelp.ansys.com/public/Views/Secured/Electronics/v252/en/Subsystems/HFSS/Subsystems/HFSS%20Scripting/Content/SaveAs.htm) |
| 求解后数据 | `oProject.AnalyzeAll()` 可运行全部设计/设置；`oDesign.GetModule('ReportSetup').GetSolutionDataPerVariation(...)` 可查询已求解的报表数据，且**此调用不由 UI 录制**，参数须与 `CreateReport` 的上下文一致。已有报表可 `ReportSetup.ExportToFile(reportName, output.csv)`。 | [AnalyzeAll](https://ansyshelp.ansys.com/public/Views/Secured/Electronics/v252/en/Subsystems/HFSS/Subsystems/HFSS%20Scripting/Content/AnalyzeAllProjectmenu.htm)；[HFSS 3D GetSolutionDataPerVariation](https://ansyshelp.ansys.com/public/Views/Secured/Electronics/v252/en/Subsystems/HFSS/Subsystems/HFSS%20Scripting/Content/GetSolutionDataPerVariation.htm)；[HFSS 3D ExportToFile](https://ansyshelp.ansys.com/public/Views/Secured/Electronics/v252/en/Subsystems/HFSS/Subsystems/HFSS%20Scripting/Content/ExportToFileReporter.htm) |

更正：先前研究引用的 `.../Subsystems/HFSS3DLayout/.../InsertSetup.htm` **确实是 3D Layout 页面，不应用于 HFSS 3D 的 `InsertSetup` 参数**。上表已换为 HFSS 3D 专属页面。`GetSolutionDataPerVariation` 也已用 HFSS 3D 专属页面核对，其示例明确从 `oDesign.GetModule('ReportSetup')` 调用；但实际报表类型、solution 名称、端口表达式取决于模型和已求解状态，不能写成通用常量。

HFSS 3D 求解层宜使用单文件内生成的极简、物理上有效的波导或其他模型，包含正确的端口、边界、网格/设置并在运行前做设计校验。官方安装例 `Tee.aedt` 描述了三端口真空波导、非端口外壁默认为 PEC、8–10 GHz 设置以及 S 参数，但它只能作为**设计依据或可选对照材料**；若实际运行依赖该 `.aedt`，便不是从空白开始的单文件回放。官方示例所报资源/时间也不是 Student 许可下通过的证明。[HFSS Tee 模型说明](https://ansyshelp.ansys.com/public/Views/Secured/Electronics/v252/en/Subsystems/HFSS/Content/GettingStarted/Tee.htm)。

## 独立验证与许可门槛

1. **先确认环境**：目标 exe 的完整路径、文件版本、可用设计类型、许可证类别/feature、是否为 Student/Trial。安装目录或 Twin Builder 的存在不等于 HFSS/Mechanical 可用；“应用可启动”“脚本运行”“可保存项目”“可求解”分别留证。
2. **脚本/几何层**：使用新建隔离输出目录与明确文件名，禁止覆盖；记录脚本哈希、进程退出码、应用消息、项目文件存在性。脚本运行后重新打开生成项目，再由 API 查询对象名称、数量、尺寸、体积、材料和设置；结果与预先给定的真值比对，不只检查文件出现。
3. **求解层**：许可证允许且模型物理有效时才求解。Mechanical 对照支撑/载荷范围、单位、网格数量、结果最大值和反力；HFSS 对照端口、边界、设置频率、网格数量、S 参数/收敛信息，并记录容差。Student 网格限制可能导致求解失败，失败应区分为许可证/模型/资源/API 错误。
4. **Recorder 端到端层**：固定录制证据与起始场景，比较操作覆盖、对象身份、参数、拓扑、数值结果和可视呈现；单次脚本成功或求解成功不代表录制识别准确。任何无法映射或有歧义的面/实体应拒绝或标为 unresolved。

现行官方 Student 页面显示：**Ansys Student 2026 R1（Workbench/Mechanical 包）**结构物理上限 128K nodes/elements、无几何导出、HPC 最多四核，限教育性自学/教学/学生项目/演示；**Electronics Desktop Student 2025 R2（含 HFSS）** 3D 体网格 64,000、3D 表面 8,000、2D 三角形 2,000，禁几何导出，仅 DXF/STEP 几何导入、本地求解/最多四核，不支持 Workbench 集成或 beta 特性，HFSS SBR+/hybrid/mesh assembly solve 不支持。两个是独立包，限制不能互套。[Ansys Student 页面](https://www.ansys.com/academic/students/ansys-student)；[AEDT Student 页面](https://www.ansys.com/academic/students/ansys-electronics-desktop-student)；[HFSS 2025 R2 Student 限制](https://ansyshelp.ansys.com/public/Views/Secured/Electronics/v252/en/Subsystems/HFSS/Content/GettingStarted/HFSSStudentLimitations.htm)。

**Trial**：未取得 VM2 的具体许可证条款，不能从 Student 限制推断 Trial 的使用范围、期限、网格或自动化权限。特别是 Student 官方用途限制意味着不能仅因软件免费就假定本项目的开发/商业回归测试用途被授权。主智能体核实安装与许可前，所有以上可执行建议保持“文档设计/待验证”，不标为实机通过。
