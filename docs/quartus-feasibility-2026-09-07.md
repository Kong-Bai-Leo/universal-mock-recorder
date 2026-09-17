# Quartus 视觉 Recorder：初步可行性核查

核查日期：2026-09-07。范围：现有远程安装的只读界面检查与官方手册核对，未开发 Quartus recorder，未运行模型 API 分析或编译工程。

## 结论

可采用用户要求的链路：截图/鼠键采集 → AI 输出结构化 JSON → 本地校验与受控适配器 → Quartus 官方 Tcl API → 软件创建、保存并编译工程。

JSON 是录制器的数据契约，不是 Quartus 原生工程格式。适配器将受支持的数据操作转换成固定的 Tcl 调用；不让模型自由生成或执行任意 Tcl。采集侧保持纯视觉与鼠键，不通过 Quartus API 读取正在录制的工程。

## 本次实机观察

- About Quartus Prime：Version 26.1.1 Build 130 08/06/2026 SC Pro Edition；Patches Installed: None。
- 英文界面，检查时无已打开工程，显示 Home 页面。
- Tools 菜单可见 Tcl Scripts、Platform Designer、IP Catalog、License Setup。
- Help 菜单可见 Command Line and Tcl API。
- License Setup 的 Mode 可见 `Agilex 3/5E (no-co…`，尾部被控件截断；界面显示 Subscription Expir 2027.09。不把这一界面读数解释为所有器件或付费 IP 均获许可。
- 许可窗口以 Cancel 关闭；本次没有修改许可设置、创建工程、编译或烧录硬件。

这只是版本和入口核查，不是完整 UI Map，也不是 Tcl 执行成功的证明。

## 适配边界

| 用户操作 | 官方回放机制 | 本次结论 |
|---|---|---|
| 新建工程、revision、指定器件、设置顶层与添加源文件 | `project_new`、项目 assignments、`export_assignments` / `project_close` | 官方接口路线明确；本机尚未执行 |
| 引脚及项目约束 | 项目 Tcl assignments；时序约束另保持 SDC 的角色和单位 | 需要恢复真实器件、端口和约束，不可只记录点击 |
| 启动编译 | `::quartus::flow` 的 `execute_flow -compile` | 官方支持；本机许可、器件包、编译成功均未验收 |
| Platform Designer 放置 IP、设置参数、连接接口 | `qsys-script`，`create_system`、`add_instance`、参数与连接命令、`save_system` | 适合建立图形建模的 JSON 契约；尚未扫描此编辑器或核对具体 IP |
| 旧式 BDF 门级原理图 | 不能等同于 Platform Designer API | Pro 从 23.3 起不再直接综合 BDF；不能承诺当前版本直接还原并编译该路线 |
| 仿真波形或硬件行为 | 另需测试平台、仿真器及必要的板级条件 | 工程编译完成不能证明与原行为一致；本次未测 |

官方接口允许恢复工程结构，不会凭空恢复 HDL 内容。对于录制中导入的源文件、存储器初始化文件、外部 IP 和测试平台，JSON 必须表达实际依赖及缺失状态。没有来源的代码、IP 版本、总线宽度、地址、时钟、复位或约束不得补成默认真值。

建议首个验收范围是一个独立小工程的创建、器件/顶层设置、可追溯源文件或简单 Platform Designer 系统、保存及编译。先对齐逻辑、连接、参数与依赖，再单独评价布局或界面是否一致。所有测试使用新目录；不覆盖原工程，不自动执行硬件烧录。

## 许可证核对

26.1 官方发布说明指出，面向 Agilex 3 与 Agilex 5 E-Series 的编译可自动获取免费器件许可。它与本次界面可见的 Mode 相符，但没有执行实际编译，因此尚不能将此判为本机编译许可验收通过。其他器件和付费 IP 仍需各自许可。

## 官方依据

- [26.1 发布说明：免费器件许可及其他功能](https://docs.altera.com/r/docs/683706/26.1/quartus-prime-pro-edition-version-26.1-software-and-device-support-release-notes/new-features-and-enhancements)
- [project_new：创建工程、保存 assignments 的契约（25.3.1 文档）](https://docs.altera.com/r/docs/683432/25.3.1/quartus-prime-pro-edition-user-guide/project_new-quartus-project_ui)
- [26.1 execute_flow：编译流程](https://docs.altera.com/r/docs/683432/26.1/quartus-prime-pro-edition-user-guide-scripting/execute_flow-quartus-flow?contentId=b7_JsVGPMouL43DYRdCyyw)
- [26.1 Platform Designer Tcl 命令目录](https://docs.altera.com/r/docs/683609/26.1/quartus-prime-pro-edition-user-guide/platform-designer-scripting-command-reference)
- [Pro 23.3 起的 BDF 综合限制](https://docs.altera.com/r/docs/683236/25.3/quartus-prime-pro-edition-user-guide/design-synthesis)

核对的是上述官方文档与 26.1.1 界面；不是声称每个版本之间的接口细节已经经过兼容性测试。
