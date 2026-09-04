# 3ds Max：有尺寸参照的近似 Bevel

已有精确 Bevel 分支保持不变。仅在没有可读 Height/Outline 时，VLM 可以结合完整前后画布、鼠标操作阶段和同一个目标的已知尺寸，提出近似倒角参数。它不是固定的“鼠标像素 × 场景单位”换算，也不是已经校准的三维重建算法。

## 操作与图片

- 3ds Max 专用分析层保留按下拖动 → 松开 → 无按键移动 → 左键确认的候选会话。最多传 8 个路径采样点及位移、时间、确认事件，不上传全部原始轨迹。
- 候选不等于 Bevel；创建基本体等操作也有类似流程，必须由 VLM 看界面确认。
- 在原有图片总额度内优先保留操作前、第一阶段后、确认后及紧接着退出后的完整图；不开启视觉面跟踪时也保留候选会话的核心图片。
- 对最新本地录制 `20260903-191220` 的无 API 回归测试确认：Bevel 松开后的 69 条移动事件保留为 8 点摘要，确认后 `evt-00000429.jpg` 和结束后 `evt-00000435-after.jpg` 都进入原 32 张预算。
- 这是本地数据选择验证，不是重新调用 VLM 后的识别准确率验证。

## 近似参数格式与校验

`polyEdit.approximation=null` 表示沿用精确数值路径。近似路径提供：

- `method=reference_geometry_ratio`。
- `reference`：此前已确认的目标对象、操作、尺寸字段和值。只接受高置信度、非估算的正尺寸，不接受模型新编的参照、未来操作或默认尺寸。
- `heightRatio`、`outlineRatio`：相对于该尺寸的有符号比例。
- `heightRatioRange`、`outlineRatioRange`：包含估值的非零范围，方向不明确或范围过宽时拒绝。这是模型自报的不确定范围，**不是校准过的误差界限或统计置信区间**。
- `view`、`viewStable`、`referenceVisibleUnchanged`、`reason`、`limitations`：说明观察条件、视觉依据与局限。
- `confidence` 不超过 0.45。

`height`、`outline` 可填 null，由本地按照参照值乘比例计算并取 3 位有效数字。已填写的数值必须与该计算相符。VLM 的视觉比例和“参照未变形”判断仍可能错误；本地校验验证的是来源、时序和算术，不会把模型自报依据当成经过 CV 验证的测量。

需要实际上传、按时间配对的完整操作前/最终图。只有数值局部图、只有第一阶段预览、混入滚轮或视口导航、窗口改变尺度，都不能通过近似校验。已知尺寸发生修改、缩放或无法推导的几何修改后会保守失效；有效参照随分段上下文传递。

## 输出与限制

- 沿用 `semantic-trace.json`、`max-program.json`、`3dsmax-replay.ms`，不增加常规输出文件或额外 VLM 请求。
- JSON 有 `containsEstimates` 和 `replayAccuracy`；脚本注明 `APPROXIMATE BEVEL`，记录估计值和模型估计范围。
- `complete` 表示操作覆盖，不代表精确尺寸；覆盖完整但包含估算时为 `replayAccuracy=approximate`。还有未表达操作时仍为 `partial`，估算不会掩盖遗漏。
- 选面规则、拓扑版本和运行时几何保护保持不变。不能把视觉面 ID 当 MAXScript 面编号。
- 首版近似仅用于无修改器堆栈 Editable Poly 的 `bevel_faces`，使用同一目标的已知尺寸参照。没有实现一般三维尺寸恢复，也没有新增 polygon Move/Rotate/Scale、Extrude、Inset 的回放能力。此前漏掉的面移动仍会导致整体回放不完整。
- 原录制已有事件和截图即可使用新分析逻辑，无需重录或重建 recorder EXE；重新生成会正常产生 API 费用。

## 验证

`node --test tests/threedsmax-approximation.test.mjs`：比值计算、锚点有效性、精确分支兼容、跨段、证据缺失、第二阶段、选图预算、模拟 VLM 单请求等。

`node scripts/test-3dsmax-bevel.mjs`：在独立的 3ds Max batch 进程和合成场景中验证编译的几何结果，不操作用户桌面的当前场景。

## 参考

- [Autodesk：Bevel 的拖动、松开后移动和点击确认流程](https://help.autodesk.com/cloudhelp/2022/ENU/3DSMax-Modeling/files/GUID-D978D03F-B6CA-4F0D-9A10-09A7AFA748D6.htm)
- [OpenAI：Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)：格式约束不保证数值事实正确；估算和未知状态必须显式表达，并保留本地语义校验。
