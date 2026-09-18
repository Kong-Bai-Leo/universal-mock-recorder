# JMP 19.1 录制器（首版）

必须在 JMP 所在 Windows 会话内运行 `bin/jmp-recorder/JmpRecorder.exe`，不能在笔记本录 RDP 窗口代替。输入按 `jmp.exe` 过滤，截图仍是全桌面：请关闭敏感内容。无需管理员权限；不依赖 JMP 内部接口采集。

## 使用

1. 从独立新建的回放目标表开始录制。未触碰的后台表不属于回放清单；若读取或修改已有且初始内容不可见的表，首版仍拒绝重建。
2. 新建小型数据表，明确列名、Numeric/Character、Continuous/Nominal/Ordinal，输入单元格；支持的分析是连续数值 Distribution、Fit Y by X/Bivariate、Fit Line。
3. 停止并保存。先点“准备分析（不上传）”，检查 `generated-jmp/prepare-report.json` 的图片、分段、警告与模型。
4. 同意传给 OpenAI 后点“正式分析/继续”。每轮最多 2 次请求，每次最多 12 张图、6000 输出 tokens，不自动重试。达到预算保存检查点；继续需再次确认。未知结果/失败重试可能重复计费。
5. 全部分段通过校验后，默认输出 **`generated-jmp/<内容标识>/jmp-replay.jsl`**。点击“打开脚本位置”，只需把这一个文件交给使用者；不需要 JSON、另一个 AI、录制器、Node.js、API 密钥或原始数据文件。生成不会自动操作 JMP，预算暂停或未解决操作不会当作完整脚本交付。
6. 在 JMP 脚本编辑器中打开该文件，取消文本选择后选择 **Edit > Run Script** 运行全文。参见 [JMP 19 Scripting Guide 的 Run a Script](https://www.jmp.com/content/dam/jmp/documents/en/support/jmp19/scripting-guide.pdf)。脚本创建独立新表与报告，在 Documents/JMPRecorderReplays 的唯一子目录保存并重开；不修改现有用户表。重复运行同一文件会拒绝覆盖该目录，不要删除源数据来处理这项保护。

内部仍让分析 AI 返回 JMP 的原生接口、对象、参数和操作，再进行本地校验及受控编译。接口计划保存在同目录的 `_internal/replay-plan.json`，仅供审计，不是运行依赖；请求、截图与检查点仍保留本地。详见 [内部接口调用契约](../../docs/jmp-api-plan.md)。

JSL 重建校验后的最终表格和受支持的分析结果，不逐次重放鼠标/键盘或历史重命名。保存重开断言验证行列和每个值；统计值与源录制一致性仍需独立验证，生成成功不等于已在 JMP 执行成功。

名字首版使用 ASCII 字母开头的字母、数字、空格、下划线或连字符；最多 4 张表、12 列/表、100 行/表。数值看不清、未知初始表、导入、公式、筛选、删行列、分析后改数据、其他分析不支持时明确报未完成。暂停期间的变化不能证明，因此包含暂停的录制首版拒绝分析。

模型只返回结构化数据；固定本地编译器生成 JSL，模型代码不会直接运行。UI Map 的 ID 是知识条目，不是运行时列或对象 ID。键鼠、截图、请求与日志默认留本地，不提交 Git。

API 配置沿用项目现有配置及本地 `.env`；打包不会包含用户配置或密钥。可把 VM 内录制复制回已配置的开发机分析，避免向 VM 放密钥。

### 已有模型结果的离线重新编译

若旧分析只返回了**连续的前几段**，而后续分段尚未返回，可先离线验证并导入已返回前缀，再从新的分析目录继续剩余段：

```powershell
node src/analyzer/jmp-cli.mjs --recording "<录制目录>" --config "<同一模型配置>" --resume-saved-run "<已有前缀的原分析目录>"
```

该命令本身不上传、不重新购买前缀请求，要求原响应、证据哈希、版本、提示、知识和模型配置完全匹配，并创建独立的新分析目录；它不补齐尚未返回的段。随后检查返回的 `runDirectory`，按正常正式分析流程显式确认继续可能收费的后续请求。不要把失败、非连续或有歧义的响应冒充可复用前缀。当前 PowerShell 包装入口未提供 `ResumeSavedRun` 参数，请直接使用上述 CLI。

如果所有分段已返回，只因本地校验/编译逻辑失败，修复后可运行：

```powershell
node src/analyzer/jmp-cli.mjs --recording "<录制目录>" --compile-saved-run "<该录制的 generated-jmp 下原分析目录>"
```

`--compile-saved-run` 与前缀续用不同：它要求**所有**分段均已返回，仅离线重新编译，不加载密钥、不调用 API、不修改原始响应。它逐段核对完整 provider 返回、原始结构化结果、请求事件/截图哈希、schema、提示、接口目录、知识库及前置对象目录；缺段、多份响应有歧义或证据改变时拒绝复用。`jmp-replay.jsl` 和内部计划另存 `generated-jmp/offline-compile-*/`，保留来源哈希和操作编号映射。操作编号按分段区分，表/列/报告 ID 不改写；同段编号重复和跨段对象身份冲突仍拒绝。界面中的正式分析仍是可能收费的路径，不要用它代替此离线模式。

也可以用 PowerShell 包装入口：`scripts/analyze-jmp-recording.ps1 -Recording "<录制目录>" -CompileSavedRun "<原分析目录>"`。离线模式不能与 PrepareOnly、Analyze 或 RetryFailed 混用。

旧版 1.0 响应只有语义操作，没有 AI 返回的接口。它不能通过本地填字段冒充新版 AI 结果，因此不会自动迁移为新版计划；旧文件保留。重新分析需要重新准备并单独确认费用。

旧参数 `--export-validation-jsl` 仍接受以兼容已有命令，但不再必要，也不会另生成第二份 `jmp-validation.jsl`。输出字段 `primaryOutput` / `replayScript` 指向唯一 JSL；旧 `validationScript` 字段保留为同一路径的别名。`plan` 指向内部 JSON，不应再作为用户交付入口。原有分析目录和文件不会被迁移或删除。

### 截图时序

普通操作前后图之外，JMP 分支在没有新输入且窗口仍为 JMP 时，尝试额外延迟约 800 ms 补拍一张后态图。它保留独立时间戳，不代表已经检测到界面稳定；慢报告仍可能超出等待时间。准备分析会保留这些图，并标注晚于下一动作的截图，不将它们强行归因给早先动作。键盘粘贴不会读取剪贴板内容，数值必须在表格或输入字段中可读。

## 当前验收

JMP Pro 18 的一次四行 Numeric/Continuous → Distribution 真实录制，已完成五段真实 API、未手改 JSL 的原生运行、保存重开和独立源数据/统计量 GUI 对照；范围与未测项见 [2026-09-17 有界验收](../../docs/jmp-pro18-real-recording-verification-2026-09-17.md)。此前 JMP 19.1 的记录见 [旧版验收](../../docs/jmp-verification-2026-09-11.md)。一个样本通过不等于 Bivariate、Fit Line、Pro 专有功能或一般录制都已验收。
