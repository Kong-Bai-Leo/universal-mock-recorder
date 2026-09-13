# JMP / Vivado 单文件版本发布检查（2026-09-12）

## 本次范围

从远端 `7380479` 基线集成本地 JMP / Vivado 录制器、UI Map、分析器、受控原生脚本生成器、测试与说明。主要交付为 `jmp-replay.jsl` 和 `vivado-replay.tcl`，接口计划仅作内部审计。包含两款分析器所需的共享 API 预算与响应审计钩子，不改变用户选定模型。

保留同事的 Quartus 提交和已有 Vivado 结果快照，不覆盖本地主工作目录其他未提交工作。真实录制、截图、请求体、密钥、EXE、运行时与安装包不进入这次代码提交。使用独立发布检出集成，主工作目录仍保留原基线和未提交工作，未执行强制重置。

## 发布代码上的验证

- JMP 55、Vivado 30、共享 API 客户端 10：共 95 项离线测试通过。
- Quartus 131 项：130 通过、0 失败，1 项文件符号链接测试因 Windows 权限跳过；目录 junction 测试通过。Tcl 测试中的 Quartus API 为模拟接口，不是本轮实际 Quartus 执行。
- JMP、Vivado、Quartus、AutoCAD、3ds Max、KiCad、PSCAD 七种录制器编译配置通过。一次临时编译命令使用相对正斜杠路径被旧 C# 编译器错误解析，改为绝对 Windows 路径后通过；没有修改业务代码来处理此命令问题。
- Quartus 配置反射检查通过：目标进程、manifest、禁用 UIA 与键盘取证规则；没有安装输入钩子、截图或操作应用。
- 预处理后的既有 Quartus、PSCAD、KiCad、AutoCAD、3ds Max 活动源码与远端基线逐行一致（忽略空行）；新行为限制在 JMP / Vivado 编译分支。
- 限定文件集合凭据模式检查无命中。文件清单不包含录制、请求、原图或密钥。
- 本轮 0 次真实 API、没有操作 VM 或启动目标软件；离线/编译不替代实机还原。

## 尚未执行或不在支持范围

- 两款新版默认脚本入口和录制器尚未更新到 VM，也未在 VM 重新录制、分析和运行本次默认输出。历史小样本实机验收不等于新包端到端回归。
- Vivado：空 RTL 工程配置曾完成真实录制、API 和原生重建；完整可见 HDL、源文件集/顶层、综合与实现尚未实机闭环。约束、仿真、IP、bitstream 和硬件不在当前后端支持范围。
- JMP：已有小型数据表与 Distribution 的真实样本，以及合成 Bivariate / Fit Line 原生测试；更多真实录制、关闭 UIA、复杂工作流尚未完整验收。导入、公式、筛选、删行列、分析后改数据及其他统计平台未支持。
- 原软件清单中的 Mechanical、HFSS、OrCAD、Tableau、Stata、SAS、Prism、Metashape：目前查阅到的项目记录未包含它们完整的“录制 → API → 脚本 → 原生结果对照”验收。安装或许可检查不能算已跑完整流程；本轮没有重新检查 VM 安装/授权状态。
- ANSYS 已做的是 Twin Builder 的合成工程后端验证，不能代替 Mechanical/HFSS，真实录制分析曾被 API 过载阻断。
- Quartus 同事记录了与门样本实际重建与完整编译通过；不是“没跑”。PSCAD 主机已有生成工程的历史记录，本轮未连接主机复核其完整端到端与仿真验收，暂不升级结论。

详细边界以 [JMP 支持矩阵](jmp-support-matrix.md)、[JMP 验证](jmp-verification-2026-09-11.md)、[Vivado 支持矩阵](vivado-support-matrix.md)、[Vivado 验证](vivado-verification-2026-09-12.md) 和同事的 [Quartus 记录](quartus-recorder-status-2026-09-07.md) 为准。
