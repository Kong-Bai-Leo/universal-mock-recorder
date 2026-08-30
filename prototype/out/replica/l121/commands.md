# 课时121 截面平面 —— 命令流

蒙太奇覆盖: 19/19 (100%)

## 命令序列
SPHERE → ZOOM _E → SECTIONPLANE(类型 = 平面;选项 绘制截面 D / 正交 O / 类型 T)→
SECTIONPLANEJOG(添加折弯)→ SECTIONPLANETOBLOCK → FLATSHOT → XEDGES →
PCEXTRACTSECTION → BOX(长度 L) → MOVE

## 教学要点(回显)
- 「_sectionplane 类型 = 平面」
- 「_xedges 找到 1 个 / 对象不具有任何边」
- SECTIONPLANEJOG「指定截面线上要添加折弯的点」

## 数值证据
**无**。SPHERE 在 t=29.8s 的「指定半径或 [直径(D)]:」提示后面既没有 `<默认>` 也没有键入值,
BOX 的角点/长度同样全部鼠标拾取。视频中出现过一次键入 `500`,但被当成命令解析
(「未知命令"500"」),不是几何参数。

## 剔除
SECTIONPLANE 反复 *取消* 6 次以上;误输入 `m'm密码`、`3DPAN2` 等无效命令。

## 结论
无可复刻的成品图形。
