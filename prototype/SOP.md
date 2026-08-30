# 单课复刻作业规程(SOP)

给每个 subagent 的标准流程。**严格按此执行,不要自创路径。**

工作根目录:`C:\Users\aaron\orca\universal-mock-recorder\prototype`
视频目录:`D:\Black Myth\CAD零基础入门到精通教程，设计+建模+绘图轻松搞定（浅显易懂）`
产出根目录:`prototype\out\replica\l<课时号>\`

---

## 铁律(违反即返工)

| # | 要求 |
|---|---|
| R1 | **必须由 CV 走完整段视频**产出步骤序列;不允许跳看视频后凭结果自己重建 |
| R2 | 复现的是**过程**:命令、顺序、参数都要来自视频证据 |
| R3 | 视频里的取消/撤销/重画要识别出来,但不进入最终执行序列 |
| R4 | 任何数值必须有证据出处(命令行回显 / 标注文字 / 像素测量),**不得推测** |
| R5 | 完成后必须独立验证(`verify.py` 输出的实体清单;有标注的课回读标注文字) |
| R6 | 报告必须如实标注置信度,并明确写出做不到的部分 |

**并发安全:绝对不要 `Stop-Process` 全部 accoreconsole 进程** —— 其它 agent 正在并行跑,会被你打断。
`run_lesson.ps1` 已处理好自身进程的超时,直接用它。

---

## 五步流程

### 第 1 步:CV 全片探测

```powershell
$d = "D:\Black Myth\CAD零基础入门到精通教程，设计+建模+绘图轻松搞定（浅显易懂）"
$v = (Get-ChildItem $d -File | Where-Object { $_.Name -match "^<N>-" }).FullName
py -3.11 "C:\Users\aaron\orca\universal-mock-recorder\prototype\cv\probe.py" $v `
   "C:\Users\aaron\orca\universal-mock-recorder\prototype\out\replica\l<N>\cv" --no-slices
```

耗时约 3–6 分钟/课,用 `run_in_background: true`。
产出 `cv\cmdmont\m00.png, m01.png, ...`(命令行条带蒙太奇,每张 16 条)。

`--no-slices` 是为了并行提速;需要动作证据包时去掉该参数。

### 第 2 步:读命令流(这是 agent 的核心工作)

**逐张读 `cv\cmdmont\*.png`**,提取:
- 用了哪些命令、什么顺序;
- 命令行回显的**数值参数**(半径、长度、角度、间距、份数……)——这是最高等级证据;
- 哪些是取消/撤销/重画(`*取消*`、`u`、`_erase`),记录但不执行。

覆盖率要求:**至少读 60% 的蒙太奇**,且必须覆盖有数值参数的时段。

### 第 2.5 步:优先找"高等级证据通道"(强烈建议)

在退到像素测量之前,**先找下面这些通道**——它们给出的是精确值,不是估计:

| 通道 | 拿到什么 | 怎么找 |
|---|---|---|
| **`BOUNDARY` + `LIST`** | **多段线的全部顶点世界坐标** —— 全课程最硬的证据 | 讲师用 BOUNDARY 提边界后 LIST 查看时,命令行会完整吐出顶点表 |
| 提示里的 `<默认值>` 回显 | 等于**上一次实际用的值** | 如 `指定底面半径 <2626.2954>`,课时104 靠这个做到 MASSPROP 零误差 |
| `DIMLINEAR` / `DIMCONTINUE` 链 | 尺寸链各段与总长 | 链能**自己闭合**(各段之和 = 总长)就是自校验;缺的段可由闭合方程唯一解出,不算推测 |
| `MEASUREGEOM` / `DIST` / `AREA` | 面积、周长、距离 | 可用来反算矩形边长 |
| 特性面板(选中对象后) | 直径/周长/面积/图层/颜色 | 抽帧放大读,D 级 |
| 目标图/标题页标注 | 整套规格 | 案例课开头常有,是规格书 |

**跨集交叉校验**:同一案例的多集,后集的标注链可以**证伪**前集的像素测量。
课时99/100 最初按像素做成 14120×8560,被课时101 的命令行标注链证伪后
按 C 级证据重做为 13500×8430 —— 三集共用同一套轴网才自洽。

### 第 3 步:测量终态几何(徒手内容用)

先看终态画布决定用哪一帧:

```powershell
py -3.11 -c "import cv2,sys; c=cv2.VideoCapture(sys.argv[1]); print(int(c.get(7)/c.get(5)),'秒')" $v
```

然后测量(**必须加 `--color white` 分离几何与黄色标注**):

```powershell
py -3.11 prototype\cv\measure.py $v <秒> "out\replica\l<N>\geo" `
   --color white --roi "185,140,1200,590" --minlen 28 --minr 15 --maxr 220 --support 0.55
```

- `--roi` 避开左侧功能区/弹出菜单(菜单会造成大量误检);
- 看 `geo_overlay.png` 人工确认检出是否正确,不对就换帧或调参;
- 输出 `geo.json` 含 `lines / circles / arcs / ellipses`。

### 第 4 步:生成脚本

优先级:**命令行确认的数值 > 像素测量**。

- 有确切尺寸的图形(如"边长100的等边三角形")→ 解析式精确构造;
- 徒手图形 → 用测量结果:

```powershell
py -3.11 prototype\cv\to_scr.py "out\replica\l<N>\geo.json" `
   "out\replica\l<N>\l<N>.scr" "out\replica\l<N>\l<N>" --flipy 597
```

复杂课(阵列/倒角/修剪等)自己写 `.scr`,输出路径固定为:
```
_.SAVEAS 2018 C:/Users/aaron/orca/universal-mock-recorder/prototype/out/replica/l<N>/l<N>.dwg
_.DXFOUT C:/Users/aaron/orca/universal-mock-recorder/prototype/out/replica/l<N>/l<N>.dxf 16
```

### 第 5 步:回放 + 验证

```powershell
powershell -File prototype\run_lesson.ps1 <N>
```

成功会打印实体清单。失败会打印日志尾部 —— 按下面的坑表排查。

---

## 无头 AutoCAD 坑表(全部踩过,照着避)

| 现象 | 原因 | 解法 |
|---|---|---|
| 命令莫名重入,吃掉下一条 | **连续空行 = 连续回车**;行尾空格已是回车,后面再跟空行就重复 | 合并连续空行;行尾有空格就别再加空行 |
| SAVEAS 无响应挂死 | 目标文件已存在,弹覆盖确认无人应答 | 回放前先删旧产物(`run_lesson.ps1` 已内置) |
| `Valid hatch boundary not found` | 填充边界检测依赖当前视图 | 填充前 `_.ZOOM _W` 覆盖全部边界 |
| 点选选不中实体 | 无显示时"面内点击"被当成窗选起点 | **点必须落在实体边上**,且在当前 ZOOM 窗口内 |
| TTR / 布尔 / 修剪 拾取失败 | 同上 | 先 `_.ZOOM _E` 或窗口缩放到对象 |
| 快速 TRIM 点选无效 | 无显示 | 标准模式 + 栏选 `_F` |
| JOIN 报错 | 首问是**单选**源对象 | 改用 `PEDIT _M` + `_J` |
| PRESSPULL 无效 | 需面内点击 | 改用 `EXTRUDE` |
| LOFT 点选有歧义 | 投影重叠 | 只存在两截面时用 `_ALL` |
| FILLET 设完半径就退出 | 本版行为 | 拆成两条:`_.FILLET _R <r>` 再 `_.FILLET _P <点>` |
| PLINE 首个圆弧段 `*Invalid*` | 无前段切向,方向退化 | 用圆心 `_CE <圆心> <端点>` 或第二点 `_S` |
| POLYGON 参数报错 | 顺序是 边数→中心→内接/外切→半径 | 选项在中心**之后** |
| 渐变填充挂死 | `-GRADIENT` 不存在;`-HATCH _P _G` 后仍有交互提示 | 降级为 SOLID 并**在报告里写明** |
| 大型三维实体 UNION/ZOOM E 挂死 | 规模过大 | 拆开或省略 ZOOM E,并写明 |
| `FILLET _T` 设完不退出 | 只有 `_R` 是"设完即退",`_T` 会回到"选择第一个对象" | 串成一条 `_.FILLET _T _N _R 200`,再单独一条做倒角 |
| `COPY` 给完第二点就结束 | 本版是单次复制 | **不要**再补空行(会重入 COPY);多重复制用 `_M` |
| `MOVE _D`/`STRETCH _D` 输 `0,0,0` 无效 | 被当成"接受默认位移" | 零位移演示排在默认值仍是 0,0,0 时 |
| `DXFOUT` 后文件以空行结尾 → 卡住 | 尾部空行重新触发 DXFOUT,停在文件名提示 | 末尾补一条无害命令(如 `_.ZOOM _E`),或去掉尾部空行 |
| `DIMCONTINUE` 提前结束 | 它需要**两个**终止空行 | 收尾留两个空行,别被"合并连续空行"误删 |
| `REVCLOUD` 缺矩形/多边形/徒手画选项 | 无头版只有 [起点/弧长(A)/对象(O)/样式(S)] | 用 `RECTANG`/`PLINE` + `REVCLOUD _O` 等价实现 |
| `MTEXT` 挂死 | 走就地编辑器 | 降级 `TEXT`(保持同一字高),写明实体类型变了 |
| 剪贴板命令无效 | 无头环境没有剪贴板 | `COPYCLIP`/`CUTCLIP`/`PASTECLIP` 不纳入,写明 |
| 含中文的源文件被改乱码 | PS 5.1 的 Get-Content/Set-Content 按系统代码页读写 UTF-8 | **只用 Python 或编辑器改**,不走 PowerShell 读写 |
| `.scr` 里中文写不进去 | 编码不对 | `.scr` 存成 **UTF-8 with BOM**;控制台显示乱码只是显示问题,DXF 里落的是正确 UTF-8 |
| 字体名报 "TTC file is not supported" | 写了 `simsun.ttc` | 写字体名 `SimSun`,不写文件名;否则后续应答全部错位 |
| `TEXT` 后加空行导致命令重复 | 本版脚本模式下输一行文字即结束 | `_.TEXT` 之后**不要**加空行 |
| `-BLOCK` 窗选打包后属性顺序反转 | 块定义里属性是逆创建顺序 | `-INSERT` 供值要倒序,并**回读 DXF 的 ATTRIB 复验** |
| `-PLOT` 应答链对不上 | 答 `_N` 时问的是**页面设置名**不是设备名;PDF 设备没有 "Write the plot to a file?" 一问 | 答 `_Y` 才进设备/图纸/方向链 |
| **无头真正出图会挂死** | 答完全部提示后 540s 无输出无报错 | 降级:`Save changes to page setup` 答 `_Y`、`Proceed with plot` 答 `_N`,页面设置落进 DWG |
| `MVIEW _L _ON` 报 "Invalid window specification" | 选视口边框前视图不对 | 先在图纸空间 `ZOOM _W` 到视口范围 |
| 三维件校验 | — | `MASSPROP _L` + 空行 + `_N` 无头完全可用,是最硬的证据 |
| `MATCHPROP` 不存在 | 无头版既无 `MATCHPROP` 也无 `-MATCHPROP` | 用 `CHPROP` 把目标改成与源相同的图层/颜色,结果等价并写明 |
| `CHPROP` 选项被"选择对象"吃掉 | 选择集与选项串在一行会被当成选择输入 | 逐行给:命令 / 拾取点 / 空行结束选择 / 选项 / 值 / 空行 |
| `DIMCENTER`/`DIMRADIUS` 找不到对象 | 拾取点必须在**圆周**上,点圆心报 "No Object Found" | 取圆周上的点,且该点必须在当前 ZOOM 窗口内 |
| 先画的圆心标记挡住后续拾取 | `DIMCENTER` 生成的十字线干扰 `DIMRADIUS` | 圆心标记用系统变量 `DIMCEN` 落地,不逐个画标记 |
| `DIMRADIUS` 的"尺寸线位置"吃不到参数 | 单行串联时该问被跳过 | 每个 token 单独一行 |
| 编辑类命令点选失败("Invalid window specification") | 单点被当成窗选起点 | 编辑前先 `ZOOM _W` 覆盖全部图元,并 `PICKBOX 10~12` |
| `-STYLE` 用 TTF 字体少一问 | TTF 没有"垂直"提示,只有 backwards/upside-down | 多给的 `_N` 会变未知命令并错位后续全部应答 |
| `-ATTDEF` 的提示/默认值吃掉整行 | 这两问接受含空格的整行文本 | 每个 token 单独一行,不能空格串联 |
| `ARRAYPOLAR` 结果多一个 | 它**保留源对象**(6 项阵列得到 7 个实体) | 用 `-ARRAY` 的经典环形阵列才干净 |
| `DIMRADIUS` 拾取被标注抢走 | 同位置的标注实体/尺寸界线优先被选中 | 把 `DIMRADIUS`/`DIMANGULAR` 排在 `DIMLINEAR` **之前**;密集处先 `ZOOM _W` 到几十单位窗口再拾取 |
| `ARC _C` 起止点写反 | 它是**逆时针**画弧, 写反只得短弧 | 会连累后续 `DIMRADIUS` 拾取失败并挂到超时 —— 画完先核对弧的角度范围 |
| `MSPACE` 报 "no active Model space viewports" | 图纸空间当前视图没覆盖新建视口 | 每个 `MVIEW` 前后各加一次 `ZOOM _W` 到视口范围 |
| `-TABLE` 的列宽/行高设不进去 | 它只问列数/行数 | 列宽行高走"指定插入点"那一问的 `_W` / `_H` 选项,设完再给插入点 |

---

## 交付物(每课)

```
out\replica\l<N>\
  l<N>.scr      回放脚本
  l<N>.dwg      成品
  l<N>.dxf      校验用
  log.txt       回放日志
  geo.json      测量结果(若用了测量)
  geo_overlay.png
  cv\           CV 全量输出
```

## 报告格式(返回给主控)

每课一段,必须包含:

```
课时 <N> <标题>
- 状态: OK / 部分完成 / 失败
- 命令流: 读了 <x>/<y> 张蒙太奇;提取到的命令与参数(列出确切数值)
- 剔除: 视频里的取消/撤销/重画 <条数与时间点>
- 构造: 说明每个图形怎么来的(解析式 / 测量)
- 验证: verify.py 的实体清单;有标注就写标注回读值
- 证据等级: C(命令行) / D(标注回读) / M(像素测量) / L(布局排列)
- 做不到的部分: 明确列出(没有就写"无")
```
