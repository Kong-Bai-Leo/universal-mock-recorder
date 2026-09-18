# JMP：内部接口计划与单文件 JSL 交付

2026-09-12。内部分析输出契约为 2.0，目标 JMP 19.1 英文版。不是把旧的操作 JSON 改名，也不是本地根据 `kind` 补写接口。用户后续明确要求一个直接在软件运行的文件，因此最终默认交付改为 `jmp-replay.jsl`，不要求再交给执行 AI；下文 JSON 是内部校验/审计契约。

## 数据流

截图/事件 + 相关 UI Map + 受支持接口目录 → 分析 AI 返回操作及 `apiCall` → 本地校验 → 受控最终状态编译器 → `jmp-replay.jsl` → 用户在 JMP 中运行。

分析 AI 必须提供每个 `apiCall`，本地不修复遗漏的选择。接口不在目录、参数与操作字段不一致、对象未创建、X/Y 角色冲突等情况会拒绝完整脚本交付，保留原响应供排查。`_internal/replay-plan.json` 保留原调用、证据和接口说明；JSL 内嵌已确认的表格数据和分析角色，不在运行时读取 JSON 或请求 API。

此后端重建最终数据和分析，而非逐项照抄每次调用或历史 UI 动作。支持范围与精度限制没有放宽。脚本在 Documents/JMPRecorderReplays 下创建隔离目录，不修改已有用户表；对未解决项仍拒绝发布。生成后标为 `replay_script_generated_not_executed`，不冒充实机验证；离线重编译标为 `saved_replay_script_generated_not_executed`，不触发新请求。

## 一项操作示例

下面是合成格式示例，不是新增的一次真实模型返回。前面需已建立 `table-1` 和数值列 `column-1`。

```json
{
  "id": "op-5",
  "kind": "distribution",
  "tableId": "table-1",
  "reportId": "report-1",
  "columnIds": ["column-1"],
  "sourceEventIds": ["evt-example-5"],
  "timestampMs": 5000,
  "stage": "committed",
  "knowledgeIds": [],
  "apiCall": {
    "interfaceId": "jmp.jsl.DataTable.Distribution",
    "member": "Distribution",
    "callType": "message",
    "receiverId": "table-1",
    "resultId": "report-1",
    "arguments": {"Y": ["column-1"]}
  }
}
```

含义：对已创建的表对象发送官方 `Distribution` 消息，将指定列绑定到 Y，保留返回的报告对象以供后续调用。这里的 ID 是稳定对象引用，不是列名、Automation ID、屏幕坐标或 HTTP 地址。

## 字段与边界

- `modelPlan`：分析 AI 返回的完整操作、调用、证据、跨段状态和未解决项。合并时只对局部 operation.id 加分段前缀，不改接口、参数和对象身份。
- `interfaceCatalog`：只附上计划实际引用的官方接口条目、接收对象类型、参数结构、说明与文档来源。由程序附加文档，不冒充模型生成。
- `consumerContract`：执行规则与安全边界，包含对象绑定、1-based 行索引、数据类型、初始表默认列和校验方法。
- `expectedState`：从已验证操作推导的表/列/单元格及分析角色，供执行后检查；不是独立源真值。
- `verification`：只标为结构/语义检查通过，原生执行和源录制比较均保持未测。

`apiCall.receiverId` 对应接收消息的表/列/报告。只有新建表的全局函数用空字符串。`resultId` 只用于新对象绑定；其他调用使用空字符串、丢弃返回值。例如 `Set Name` 的返回字符串不能替换表对象引用。

目前有 9 个受支持接口条目：New Table、Add Rows、New Column、表与列各自的 Set Name、列索引赋值、Distribution、Bivariate、Fit Line。不是完整 JMP 接口库。原来的操作、数据规模与精度限制不变。

### 初始表的默认列

旧版实测发现单独 New Table 后追加列可能留下隐式 Column 1。执行方必须在新隔离表内，将计划的初始 New Column 定义组合进 New Table 构造，再绑定各列并执行数据写入；核对列数，不能删除已有用户表里的列来凑结果。这个执行约束包含在每份交付 JSON 中。

### 与旧版的区别

1.0 响应只包含操作，接口由固定编译器决定；2.0 由分析 AI 同时输出原生接口和参数。已有付费响应、截图和验证产物均保留，不通过本地添加字段声称旧 AI 已选接口。新契约需要新的准备确认；代码修改本身不授权付费请求，实际分析须另经用户授权。

曾经默认只交付 JSON，并用 `--export-validation-jsl` 显式导出辅助脚本。现已按新的单文件要求默认生成同一受控后端的 `jmp-replay.jsl`；旧参数作为兼容空操作保留，不额外生成第二份脚本。本轮不改模型 schema 或提示，证据一致的已有 2.0 响应可离线复用；旧版实机验证、新版逐接口验证和本次默认交付改动仍分别记录。

## 分段完整性检查（2026-09-12）

`complete` 只表示本段已完成、具有持久贡献的操作是否全部表达，不表示录制已结束。程序通过 `chunk.isLastChunk` 给出录制位置；等待输入的对话框单独放在 `commandState.pendingEventIds`。非末段、尚有待提交输入都不自动意味着 `complete=false`。

- `complete=false` 必须有 `unresolved` 条目、来源事件及非空原因；`true` 不能同时包含未解决项。逐段检查后才保存为有效检查点，矛盾结果保留原响应并立即停止，不继续花费后续请求。
- 后续请求携带已验证的逐段覆盖状态及遗漏清单，不能靠最后一段的 `true` 清空前面实际遗漏。当前版本不自动补写已完成的早期操作；修复需要独立受控流程与授权。
- 最终仍分别检查实际遗漏、初始场景、最终表/报告清单和待提交交互。完整性矛盾报告为 `JMP_COVERAGE_CONFLICT`，不再混报为网络或真实遗漏。
- 提示词、schema 描述和上下文结构更新会生成新的分析身份，旧付费结果不会被强改为完整或自动移入新检查点。默认零自动重试、每轮最多两次请求。完整校验后本地编译 JSL，不自动执行 JMP。

上述规则只验证输出一致性，不能证明视觉识别或原生回放准确。

离线回归：JMP 专项 53 项、全项目 264 项通过，包含无理由 false、真假状态冲突、真实遗漏跨段保留、pending 独立校验、首段失败立即停止请求，以及三段结果的离线重编译。测试使用合成响应，不冒充真实模型结果。

同日经用户授权进行真实三段分析：3 次请求、零重试，各段完整性检查通过，生成 9 项模型提供的接口调用。逐项核对原始 provider 响应、解析结果与交付计划一致（仅 operation 标签按规则命名空间化）。之后按用户要求，已在 VM3 的 JMP Trial 19.1.5 中执行该新计划：按 `apiCall` 逐项绑定和调用，初始列依 consumerContract 合入 New Table 构造；保存重开后的 3 行1列、值 [3,5,8] 和 Distribution 统计与独立源真值一致。详见 [新版实机验证](jmp-verification-2026-09-11.md)。本轮实机验证没有新增分析请求；验证适配器只在该录制的 validation 目录中，不代表生产通用执行器或 VM 安装包已同步，也不代表其他接口组合均通过。

## 官方依据

接口名称、接收类型和主要参数核对自 [JMP 19 JSL Syntax Reference](https://www.jmp.com/content/dam/jmp/documents/en/support/jmp19/jsl-syntax-reference.pdf) 与 [JMP 19 Scripting Guide](https://www.jmp.com/content/dam/jmp/documents/en/support/jmp19/scripting-guide.pdf)。列创建与追加行另见 [Create Columns](https://www.jmp.com/support/help/en/19.0/jmp/create-columns.shtml) 和 [Add Rows](https://www.jmp.com/support/help/en/19.0/jmp/add-rows.shtml)。接口目录声明为 JMP 19.1 使用的有界兼容契约；文档核对不等于当前安装中所有组合都已实测。
