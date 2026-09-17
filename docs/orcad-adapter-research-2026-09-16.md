# OrCAD 24.1 Recorder 适配：接口研究与待验证项

日期：2026-09-16。本文汇集只读资料研究、主任务提供的 VM2 局部实测与后续测试建议，不是已完成的适配器、录制或回放验证报告。本研究子任务未操作 VM 桌面、未调用付费 API；下文的实测来自主任务。Cadence 发布的产品资料与 Cadence 社区讨论分开标注；社区中的用户代码即使出现在 Cadence 站点，也不等于厂商对 24.1 接口行为的保证。

## 当前环境边界

主任务对 VM 的实际观察确认存在 Capture CIS 24.1、Capture Viewer 24.1、System Capture 24.1 和 OrCAD X PCB Presto 24.1 启动项；随后英文 Capture 进入工作区，About 实测为 **OrCAD X Capture 24.1 P001 (4234998) [9/4/2024]，Windows SPB 64-bit Edition，产品 Capture**。主任务已通过 GUI 在 `C:\Users\user\Documents\RecorderCapture_20260916_1037` 新建隔离项目并开展下述命令冒烟测试；这证明当前会话能编辑该测试页，不等于已确认全部许可权益。本研究子任务未操作该工作区。PCB Editor（不同于 Presto）是否可启动仍未确认。Cadence 的 [24.1 OnCloud 许可说明](https://resources.pcb.cadence.com/pcb-design-blog/24-1-install-guide-licensing-using-and-managing-oncloud-license) 列出 OrCAD X Capture、OrCAD X PCB Editor、OrCAD X PCB Presto 等产品支持的许可模式，但具体 entitlement 仍须在 VM 核查。

## 已核实的接口线索与来源级别

| 产品/资料级别 | 可确认的接口或格式 | 适配含义与限制 |
| --- | --- | --- |
| Capture；[Cadence 产品资料](https://resources.pcb.cadence.com/i/973629-orcad-capture/2) | Capture 的 Tcl 接口可访问 UI、命令、连接对象和设计数据库。 | 证明 Tcl 是产品级扩展路径，不证明任一具体命令在当前 VM 可用。 |
| Capture；[Cadence 社区讨论](https://community.cadence.com/cadence_technology_forums/pcb-design/f/allegro-x-scripting-tcl/57474/connecting-multiple-signals-to-component/1391469)中的用户示例 | 在已打开设计并选中元件后，用 `GetSelectedObjects`、`PlaceWire x1 y1 x2 y2`、`PlaceNetAlias x y name`；在 Capture 命令窗 `source {<path>.tcl}`。示例还用页面的 `GetPhysicalGranularity` 换算坐标。 | 可以作为最小 Tcl 候选，不可把屏幕像素直接当作页面坐标，也不可默认所选对象唯一或类型正确。24.1 的一组具体 `PlaceWire`/`PlaceNetAlias` 调用已有局部实测；社区示例的全部前提与结果仍不可据此泛化。 |
| Capture；[Cadence 社区技术回复](https://community.cadence.com/cadence_technology_forums/pcb-design/f/allegro-x-scripting-tcl/63440/how-to-select-a-project-and-save-it-with-tcl-command) | 给出 `Menu "File::Save"`；讨论涉及 SPB24.1，也记录了项目管理器激活设计时的失败反馈。 | 当前活动 GUI 项目实测调用返回 `1`、标题星号消失；尚未关闭重开确认内容，也不可据此推断自动项目选择。 |
| Capture；[Cadence 社区技术回复](https://community.cadence.com/cadence_technology_forums/pcb-design/f/pcb-design/15614/orcad-capture-tcl-scripting/1294051) | `XMATIC_DSN2XML <DSNFilename> <outputXmlName>` 可导出设计对象及关系；安装路径被指为 `tools/capture/tclscripts/OrCAD_Capture_TclTk_Extensions.pdf`。 | XML 适合独立检查对象与连接关系；尚未在 VM 确认该命令和文档文件存在。24.1 [版本说明](https://community.cadence.com/cadence_blogs_8/b/pcb/posts/cadence-orcad-x-and-allegro-x-24-1-is-now-available)指出 Windows 默认只随安装提供部分文档，缺本地 PDF 不能单独判定接口缺失。 |
| Capture；[Cadence 产品资料](https://resources.pcb.cadence.com/blog/2024-pcb-schematic-file-formats) | `.opj` 是项目、`.dsn` 是设计、`.olb` 是库。 | 隔离测试应复制或新建本地项目，不修改用户原设计。 |
| Allegro/OrCAD PCB Editor；[Cadence 社区技术回复](https://community.cadence.com/cadence_technology_forums/pcb-design/f/allegro-x-scripting-skill/62614/can-skill-be-run-in-batch-mode) | 原生 `.scr` 可录制并由 `replay <path>.scr` 执行；文中给出 `allegro -s <script> -nograph <board>` 的批处理形式，并说明批处理应显式 `exit`。另有[社区实例](https://community.cadence.com/cadence_technology_forums/pcb-design/f/pcb-design/21885/dynamic-grid-settings/1308900)说明 File → Script 的录制流程。 | `.scr` 是优先考察的单文件回放后端，但只能在确认 VM 确有 PCB Editor 后，借该版本真实录制样本核实几何命令、坐标和保存语法。不可把 Presto 的存在当成 PCB Editor `.scr` 的证明。 |
| PCB Editor；[Cadence 社区脚本示例](https://community.cadence.com/cadence_technology_forums/pcb-design/f/pcb-design/7171/running-a-script-on-package-library) | `.scr` 示例末尾包含 `save`、`exit`。 | 适合作为候选，不保证所有产品级别、上下文或版本相同。须检测保存后的 `.brd`，不能仅看脚本退出码。 |
| Allegro PCB Editor；[Cadence 产品博客](https://community.cadence.com/cadence_blogs_8/b/pcb/posts/extending-layout-with-skill)与[社区介绍](https://community.cadence.com/cadence_technology_forums/pcb-design/f/allegro-x-scripting-skill/58594/introduction-to-skill/1398322) | AXL-SKILL `.il` 可扩展 PCB Editor；Allegro 许可环境的命令窗可 `skill load("file.il")`。Cadence 社区示例展示 `axlDBCreateLine` 等数据库操作。 | SKILL 是条件性增强后端，不是当前 VM 的已验证能力。数据库函数的参数签名需查该安装帮助/`share/pcb/examples/skill/DOC/FUNCS` 并实测，不能从某个论坛代码片段推广。 |
| OrCAD PCB Editor；[Cadence 社区回复](https://community.cadence.com/cadence_technology_forums/pcb-design/f/allegro-x-pcb-editor/26897/skill-command-not-working-at-command-line/1325818) | 历史 OrCAD PCB Editor 许可可能没有交互 `skill` 命令；回复称启动时预加载的 SKILL routines 可运行。 | 该回复针对旧版许可，不可断言 24.1 一定相同；必须在实际产品与许可下核查，且不能为测试静默修改用户 `allegro.ilinit`。 |
| PCB Editor；[Cadence 产品博客](https://community.cadence.com/cadence_blogs_8/b/pcb/posts/extracting-layout-data) | `extracta` 读取 `.brd` 数据库并输出结构化文本记录。 | 可作为结果独立验证的候选；要先在 24.1 核实所选几何对象的 baseview/字段，不能只按截图或文件存在判断还原准确。 |

## VM2 Capture 24.1 P001 局部实测（主任务提供）

主任务在上述隔离 GUI 项目中确认 Capture 命令窗的 Tcl 为 8.6.5。`PlaceWire 1.7 3.0 3.7 3.0` 返回 `0`，并在活动页创建导线；`PlaceNetAlias 1.7 3.0 RECORDER_TEST` 返回 `0`，页面可见网标。`GetActivePage` 所得原始页对象的 `GetPhysicalGranularity`、`GetDocUnitsPerInch` 都返回 `100.0`。选中**这条测试导线**后，`GetStartPoint(status)`、`GetEndPoint(status)` 配合 `DboTclHelper_sGetCPointX/Y` 分别读回内部点 `START 170 300` 与 `END 370 300`。这独立证实该导线的两个端点及本例中的 100 倍数值映射；不能把返回值 `0` 单独等同完整操作正确。

进一步在原 GUI `PAGE1` 实测 `GetName` 经 `CString` 读回 `PAGE1`。`NewWiresIter $s`、`NextWire $s` 遍历至 `NULL`，再用 `delete_DboPageWiresIter` 清理，读到导线 ID `17` 和 `21`。七项查询都传入同一 `DboState`：`GetPartInstCount=0`、`GetWireCount=2`、`GetBusEntryCount=0`、`GetPortCount=0`、`GetGlobalCount=0`、`GetOffPageConnectorCount=0`、`GetCommentGraphicCount=0`。沿测试导线的 `NewAliasesIter` → `NextAlias` → `GetName`（`CString`）读到 `RECORDER_TEST`；alias 的 `GetOwner` 返回 `DboWire` 基类 wrapper，其 `GetId` 与该 wire 的 `GetId` 均为 `21`。alias 的 `GetLocation $status` 经 `DboTclHelper_sGetCPointX/Y` 读回内部位置 `(170,300)`，与 `PlaceNetAlias 1.7 3.0` 相符。这提供了本例网标名称、所属导线 ID 和位置的数据库读回；**wrapper 指针字符串不能作为对象同一性的比较依据**。电气网络连通性仍未独立核验。

当前活动 GUI 项目执行 `Menu "File::Save"` 返回 `1`，界面标题星号消失；这是保存动作的局部观察，不是独立进程重开验证。主任务还在同一隔离目录做了独立设计数据库探针：先以 `file exists` 确认 `C:/Users/user/Documents/RecorderCapture_20260916_1037/RecorderDboProbe_1100.dsn` 不存在；通过 `s=[DboState]`、`session=$::DboSession_s_pDboSession`、`DboSession -this $session`，执行 `$session CreateDesign $s [DboTclHelper_sMakeCString path] [DboTclHelper_sMakeCString RECORDER_ROOT]`，其中 `path` 为上述独立 `.dsn` 路径；接着 `$design GetRootSchematic $s`、`$root NewPage $s [DboTclHelper_sMakeCString REPLAY_PAGE]`、`$page NewWireScalar $s [DboTclHelper_sMakeCPoint 170 300] [DboTclHelper_sMakeCPoint 370 300]`。新页 `GetWireCount $s` 返回 `1`；`$session SaveDesign $design` 的返回状态 `Failed=0`，该 `.dsn` 的 `file exists=1`。

随后在**同一 Capture 会话**中以 GUI `File → Open → Design` 打开该 `.dsn`，呈现非 PSpice 设计及树节点 `RECORDER_ROOT/REPLAY_PAGE`。`GetActivePage` 的页名为 `REPLAY_PAGE`，`GetWireCount $s=1`，wire ID `1` 的端点再次从数据库读回 `(170,300) → (370,300)`。因此已验证独立 DSN 文件创建、GUI 打开及本次会话中的对象数据库读回；**772% GUI 视图未见导线**，原因未定，不能宣称视觉还原或推断页模板故障。没有独立进程重开、`.opj` 生成、Dbo net alias 写入或录制回放端到端验证。

本地实现状态与上面的**接口来源级别**分开看：Capture 专用结构化 IR、受限 Tcl 编译器和 CLI 已编码，并通过离线测试；完整编译 Tcl 的实机验证仍在进行。真实录制样本→模型 API→单脚本→实机结果的端到端运行次数仍为 `0`，本研究没有触发付费 API。知识目录中的接口条目继续保持 `catalog_only` 来源标记；本机的局部原生命令事实记在上述观察，不据此把整份社区参数说明升级为 24.1 官方规范。

旧版 Cadence 编写的 [Capture Tcl/Tk Extensions PDF](https://www.ema-eda.com/wp-content/uploads/2016/06/OrCAD_Capture_TclTk_Extensions.pdf) 的 `ConvertUserToDoc` 示例（PDF 第 37 页）将 user/display 坐标乘以 `GetPhysicalGranularity` 得到内部文档坐标；上列 Cadence **社区用户示例**从 pin hotspot 的内部 `CPoint` 坐标除以该值后传给 `PlaceWire`。两者是相反方向的换算，**不构成必然矛盾**，且与本例 `1.7 → 170`、`3.7 → 370`、`3.0 → 300` 的读回一致。不过，页面原点、不同页/对象的坐标规则、网格与通用物理单位仍未验证，不能把屏幕像素或此单例比例推广为完整坐标规范。

## 从空白 Capture 到单个 Tcl：项目/设计/页面的资料边界

在继续调查后，找到 Cadence 编写的《OrCAD Capture Tcl/Tk Extensions – Application Notes》[PDF](https://www.ema-eda.com/wp-content/uploads/2016/06/OrCAD_Capture_TclTk_Extensions.pdf)，由 EMA Design Automation 镜像托管。它是**厂商编写、第三方托管的旧版资料**，文件路径显示 2016 年；不是当前 24.1 P001 的实测或兼容承诺。附录列出以下数据库方法签名；这些是文档中的对象方法形式，不是本研究已执行的 Tcl 脚本代码：

| 对象 | 文档中的方法签名与返回 | 文档页码 | 含义/限制 |
| --- | --- | --- | --- |
| `DboSession` | `CreateDesign(status, Name, RootName, RootType = SCHEMATIC) : DboDesign`；另有 `CreateDesign(status, Name, RootName)`、`CreateDesign(Name, status)` 重载 | 179 | `Name`、`RootName` 为 `CString &`，`status` 为 `DboState &`。上述三参数调用已在 24.1 P001 创建独立 `.dsn`，随后由 GUI 手动打开；不等于创建 `.opj` 或自动激活 UI 页面。 |
| `DboDesign`（继承 `DboLib`） | `GetRootSchematic(status) : DboSchematic`；继承的 `NewSchematic(name, status) : DboSchematic` | 255、223 | 取得或创建 schematic 的候选方法。`CreateDesign` 后的根 schematic 是否已存在须检查返回，不能无条件新建同名视图。 |
| `DboSchematic` | `NewPage(status, name, pageNumber = -1) : DboPage`；另有 `NewPage(status, name)` | 362–363 | 两参数调用已在 24.1 P001 创建数据库页并经 `GetWireCount` 读回一条 Dbo 导线；**未证明它成为 `PlaceWire`/`PlaceNetAlias` 需要的活动 UI 页**。 |
| `DboSession` | `SaveDesign(design) : DboState`；`SaveDesignAs(design, name, Replace = 0) : DboState`，另有省略 `Replace` 的重载 | 179–180 | `SaveDesign` 在 24.1 P001 对新设计返回 `Failed=0` 且目标 `.dsn` 文件存在；同会话 GUI 打开后读回页面和导线，但未独立进程重开或确认视觉呈现。未证明它产生 `.opj`，也未测试覆盖行为。 |

Cadence 的 [2025 PSpice/OrCAD X 用户指南](https://resources.pcb.cadence.com/pspiceuserguide/02-simulation-examples)只确认正常 GUI 新建项目为 `File – New – Project`，未给出可在**单个 Tcl 中填完整新建项目对话框**的命令签名。主任务在 24.1 P001 实测 `capNewProject` 是原生命令而非 Tcl proc；无参数调用会打开 GUI 新建项目对话框，不能视为无人值守项目构造器。Cadence [社区技术回复](https://community.cadence.com/cadence_technology_forums/pcb-design/f/allegro-x-capture-cis/59521/run-tcl-script-from-windows-terminal-to-orcad-capture-terminal/1405247)给出从 Windows 命令行启动 `capture -product="OrCAD Capture" <tcl-file>` 的候选形式；另一[技术回复](https://community.cadence.com/cadence_technology_forums/pcb-design/f/allegro-x-scripting-tcl/64810/how-to-load-orcad-db-dll-in-tcl/1405278)给出 `capture.exe <tcl-file>`。讨论亦提及已有 Capture 实例时启动不可靠，24.1 P001 尚未测试。外部 `tclsh` 加载 Capture DLL 不应当作已核实的替代运行环境。

当前实测已越过“能否由 Dbo 创建独立 `.dsn` 与页面、写入一条导线、保存并在同会话 GUI 打开读回”的初步阻点；**仍不足以交付已确认可用的单个 `.tcl` 从空白状态自动产生 `.opj`、激活页面、执行 `PlaceWire`/`PlaceNetAlias` 并保存**。关键缺口是 `.opj` 创建/项目向导填写的 Tcl 形式、新页面的可靠 UI 激活与视觉呈现、Dbo 网标写入以及独立进程重开验证。社区中的 `PlaceWire` 示例有已打开的页面前提，不能直接接在 `NewPage` 后并假定成功。

下一步建议在该隔离项目或新的隔离目录中记录新项目 GUI 的 24.1 P001 journaling/命令日志，核查能否可靠重放工程名、类型、目录与向导完成；再验证 DSN 独立进程重开、导线为何未见于 GUI 视图、Dbo 网标写入、页面激活命令以及 XML 对象/连接关系。Cadence [社区技术回复](https://community.cadence.com/cadence_technology_forums/pcb-design/f/pcb-design/18064/signal-name---global-rename-in-capture/1250207)建议通过 Capture Journaling 观察 GUI 操作对应 Tcl 命令。这些剩余步骤是测试建议，不是已完成结果；遇到对话框或活动页不明时应停止，不应猜测命令或写入当前用户工程。

## 建议的最小端到端实验（仅局部 GUI/Dbo 读写与离线编译测试已执行）

1. **先确认可用产品和许可。** Capture CIS 必须出现可编辑设计页；若只有 Viewer，不做编辑测试。PCB 侧明确区分 PCB Editor 与 Presto。记录 About 中版本/热修复、实际产品名、许可模式，以及启动失败信息，不读取或外传许可凭据。
2. **Capture 实验。** 在隔离目录新建/复制一个可编辑的本地空白 `.opj/.dsn`，记录已知页面网格和原点；界面真实操作一段导线与网标，保留前态、选中/预览、带参数证据和保存后态。结构化 IR 只开放经核验的 `placeWire` 与 `placeNetAlias`，保存坐标角色、单位、依据和精度。由本地白名单编译单个 `.tcl`，在相同空白副本上 `source`；当前项目虽已有 `Menu "File::Save"` 的局部观察，仍须重开并用 XML/数据库读回核对对象及连接。坐标尺度、页面激活或选择不明时阻止编译，记 unresolved。
3. **PCB Editor 实验（仅产品确实可用时）。** 在隔离空白 `.brd` 上经 UI 完成一条板框或丝印线及保存，同时用 File → Script 录得 24.1 `.scr` 样本。把 UI 证据解释成含层、端点、宽度、单位的结构化操作；只从实测 `.scr` 提炼白名单模板，编译单个 `.scr` 并在另一个副本回放。保存、重开后比较几何层级/坐标，并用 `extracta`（字段已核实才用）查数据库。若该 VM 只有 Presto，不能将本实验宣称完成；须另行研究 Presto 的官方回放接口。
4. **分层报告。** 分别记载 UI Map 已观察范围、采集证据、IR/schema、本地编译、空白文件实机回放、数据库/视觉结果对照，以及拒绝路径。脚本可运行不等于精确还原；未扫描控件不记作覆盖。

## 尚未核实、应阻止扩大支持声明的点

- VM 的 Capture 完整许可权益、其它 Tcl 操作及端到端回放结果；PCB Editor 是否安装且可启动，还是仅有 PCB Presto。
- 单个 Tcl 能否创建独立 `.opj`，以及 Dbo 新页面如何可靠成为 `PlaceWire`/`PlaceNetAlias` 的活动 UI 页面并可见；已验证 Dbo 写入独立 `.dsn` 且同会话 GUI 打开并读回，未解除这些阻点。
- 24.1 Capture Tcl 的通用坐标单位/原点/网格、非当前活动页的前提、电气连通性、独立进程重开后的 DSN/XML 内容、未见导线的视觉原因，及 `XMATIC_DSN2XML` 是否随当前安装可执行。
- 完整编译 Tcl 的本机运行与结果对照，以及真实录制、付费模型 API 和端到端回放；离线 IR/compiler/CLI 测试不是这些实机验收的替代。
- 24.1 PCB Editor `.scr` 对板框/丝印线的确切录制文本、坐标/层级表达、`save`/批处理运行方式；`extracta` 对这些对象可用的字段。
- 当前许可证是否允许 SKILL 交互加载或预加载；若不允许，不能承诺 `.il` 后端。若仅有 Presto，也不能套用 Allegro PCB Editor 的 `.scr`/SKILL 结论。
