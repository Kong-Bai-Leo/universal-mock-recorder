# 3ds Max 腿

3ds Max 2027。**只有真机 oracle 半边，没有视频复刻半边**——见下面「现在能做什么」。

## 通道

| | AutoCAD 腿 | 这条腿 |
|---|---|---|
| 无头执行器 | `accoreconsole.exe /s x.scr` | `3dsmaxbatch.exe runner.ms` |
| 调用形态 | 命令行输入流（空格/空行=回车） | MaxScript 参数化调用 |
| 快照 | `DXFOUT` → ezdxf 解析 | 场景反射直接序列化 JSON |

MaxScript 的调用是**参数化**的（`box length:10 width:20`、`addModifier o (bend angle:45)`），
比 AutoCAD 的提示序列干净：参数即 schema。

## 文件

| 文件 | 作用 |
|---|---|
| `gen_max_inventory.ms` | S0 驱动面普查：反射可创建类。实测 507 个（几何 94 / 修改器 144 / 材质 51 / 灯光 22 / 相机 7 / 样条 26 / helper 134 / spacewarp 29） |
| `max_snap.ms` | 场景快照 → JSON：每对象 class / pos / rot(四元数) / scale / 材质 / base_params / 修改器栈含参数 / mesh 顶点面 |
| `max_fixture.ms` | 共享 fixture：B1 立方体(2×2×2分段) / S1 球 / C1 圆柱 / SP_CIRCLE 样条 / SP_PROFILE L 型 / P1 可编辑多边形(顶面已选) / T1 自由体 |
| `archviz_fixture.ms` | 建筑可视化 fixture：墙体样条 / 地板 / 柱样条 / 线脚断面 / 布尔切割体 |
| `motion_fixture.ms` | 动画 fixture：A1 / A2 / PATH_SP 圆形路径 / TGT 目标点 |
| `gen_max_element_io.py` | IO 采集 harness：单进程循环全部 case（`resetMaxFile` 隔离），3 次重跑一致性 → 自动分层 T1/T2/T3 |
| `build_max_bundle.py` | 打包：可见/隐藏拆分，manifest 脱敏 |

```powershell
py -3 gen_max_element_io.py --cases cases.json --out io.json --runs 3
```

## 现在能做什么

- ✅ S0 驱动面普查、场景快照、真机 IO 采集（3 次重跑确定性）、离屏渲染截图
- ✅ 已产出三个 workflow 包共 151 个原子 / 358 条用例（hardsurface 99 / archviz 36 / motion 22 ops）
- ❌ **没有视频复刻**：不存在「看 3ds Max 教程录屏 → 还原 MaxScript」这条链。
  CV 那半边（`prototype/cv/`）目前只针对 AutoCAD 深色主题 + 命令行回显做过标定。

## MaxScript 坑（实测，会静默给错答案的那种）

- superclass 反射要用 `GeometryClass.classes`，`geometry` 是场景选择器不是类
- 属性名 ≠ UI 标签：`BendAngle`/`BendDir`/`BendAxis`、`Push_Value`、`Level_1_Height`、`Strut_Radius`
- `Lathe.axis` 是 Matrix3 不是轴索引；`Skew.axis` 拒绝 0 而 Bend/Twist/Taper 接受 0–2
- `tessellate.iterations` 是 0-based，`iterations:0` 执行一次
- **`geosphere baseType` 是 0-based，`baseType:3` 越界读未初始化内存**（NaN / ±1e37 坐标）
- **`sliceon` 是诱饵**：标准体上真正生效的是 `slice`，`sliceon` 静默忽略；且拼写按族不同（Capsule 用 `sliceon`，ChamferCyl/Spindle 用 `Slice_On`）
- 约束下 `obj.pos`/`obj.rotation` 返回**陈旧缓存**，只有 `obj.transform` 随时间求值
- 目标绑定的灯光/相机**没有 `rotation` 属性**（LookAt 控制器），裸读会抛异常
- `fileIn` 的脚本顶层不能用 `local`；`macros.list to:` 要 CharStream；`menuMan` 无头不存在
- 噪声类修改器必须固定 seed，否则 3 次重跑不一致
