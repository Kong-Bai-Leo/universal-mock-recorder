// 由"agent 分析"环节(本次为 Claude 人工对照 CV 证据完成)产出的语义轨迹,
// 走仓库原有的 validateWorkflow / renderTypeScript / renderComputerUseTask 流水线。
// 证据来源: prototype/out/lesson8_full 的 actions/input_events + 命令行区截图(736-828s)。
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateWorkflow } from "../src/analyzer/lib/workflow.mjs";
import { renderTypeScript } from "../src/analyzer/lib/script-renderer.mjs";
import { renderComputerUseTask } from "../src/analyzer/lib/computer-use-renderer.mjs";

const rel = (x, y) => [Math.round(x / 1280 * 1e4) / 1e4, Math.round(y / 720 * 1e4) / 1e4];

const CIRCLE_DROPDOWN = {
  semanticFunction: "draw.circle.dropdown",
  role: "button",
  textCandidates: ["圆", "Circle"],
  visualDescription: "功能区“默认”选项卡绘图面板中的圆工具按钮下拉箭头",
  expectedRegion: "ribbon.draw-panel",
  relativePositionFallback: rel(68, 78)
};
const MENU_2P = {
  semanticFunction: "draw.circle.two-point",
  role: "menu_item",
  textCandidates: ["两点", "2-Point", "2P"],
  visualDescription: "圆下拉菜单中的“两点”项(图标为过直径两端点的圆)",
  expectedRegion: "ribbon.circle-dropdown-menu",
  relativePositionFallback: rel(95, 108)
};
const MENU_TTR = {
  semanticFunction: "draw.circle.tan-tan-radius",
  role: "menu_item",
  textCandidates: ["相切,相切,半径", "相切、相切、半径", "Tan, Tan, Radius"],
  visualDescription: "圆下拉菜单中的“相切,相切,半径”项",
  expectedRegion: "ribbon.circle-dropdown-menu",
  relativePositionFallback: rel(120, 135)
};

const noChange = {
  detected: false, changeType: "none", objectDescription: null,
  beforeScreenshot: null, afterScreenshot: null,
  changedRegionRelative: null, measurements: []
};
const menuOpen = (src) => ({
  ...noChange, detected: true, changeType: "view",
  objectDescription: "圆工具下拉菜单展开,列出六种画圆方式",
  afterScreenshot: src
});
const state = (texts, visual, change) => ({
  visibleTextCandidates: texts, visualDescription: visual, stateChange: change
});

function twoPointCircle(n, pickTarget, pickGesture, evidence, screenshots) {
  const name = `圆${n}`;
  return [
    {
      id: "x", goal: `打开圆工具下拉菜单(准备画${name})`, action: "click",
      target: CIRCLE_DROPDOWN, gesture: null, value: null,
      expectedState: state(["两点", "三点", "圆心, 半径"], "下拉菜单展开显示画圆方式列表", "菜单展开"),
      canvasChange: menuOpen(screenshots.menu ?? null),
      sourceEventIds: evidence.dropdown, confidence: 0.9
    },
    {
      id: "x", goal: `选择“两点”画圆方式`, action: "click",
      target: MENU_2P, gesture: null, value: null,
      expectedState: state(
        ["指定圆直径的第一个端点", "_2p"],
        "命令行出现 _circle _2p 提示,光标变为拾取状态", "CIRCLE 2P 命令激活"
      ),
      canvasChange: noChange, sourceEventIds: evidence.dropdown, confidence: 0.85
    },
    {
      id: "x", goal: `拾取${name}直径的第一个端点`, action: "click",
      target: pickTarget, gesture: null, value: null,
      expectedState: state(
        ["指定圆直径的第二个端点"],
        "橡皮筋圆预览随光标出现,动态输入框等待第二端点", "第一端点已确定"
      ),
      canvasChange: noChange, sourceEventIds: evidence.pick, confidence: evidence.pickConfidence ?? 0.85
    },
    {
      id: "x", goal: `沿正右方向输入直径距离 20000`, action: "type_text",
      target: {
        semanticFunction: "dynamic-input.distance", role: "input",
        textCandidates: ["指定圆直径的第二个端点"],
        visualDescription: "光标旁动态输入距离框(光标须位于第一端点正右方以确定方向)",
        expectedRegion: "canvas.dynamic-input", relativePositionFallback: null
      },
      gesture: pickGesture, value: "20000",
      expectedState: state(["20000"], "动态输入框显示 20000", "直径距离待确认"),
      canvasChange: noChange, sourceEventIds: evidence.value, confidence: 0.9
    },
    {
      id: "x", goal: `确认直径,生成${name}`, action: "press_key",
      target: null, gesture: null, value: "ENTER",
      expectedState: state([], `画布出现${name},与前一圆相切(首圆除外)`, `${name}已创建`),
      canvasChange: {
        detected: true, changeType: "create",
        objectDescription: `${name}: 直径 20000(半径 10000)的圆,顶排从左向右第 ${n} 个,与左邻圆外切`,
        beforeScreenshot: screenshots.before ?? null, afterScreenshot: screenshots.after ?? null,
        changedRegionRelative: null,
        measurements: [
          { name: "diameter", value: 20000, unit: "drawing_unit", confidence: 0.95 },
          { name: "radius", value: 10000, unit: "drawing_unit", confidence: 0.95 }
        ]
      },
      sourceEventIds: evidence.value, confidence: 0.9
    }
  ];
}

function ttrCircle(n, leftDesc, rightDesc, leftAt, rightAt, evidence, screenshots) {
  const name = `圆${n}`;
  return [
    {
      id: "x", goal: `打开圆工具下拉菜单(准备画底排${name})`, action: "click",
      target: CIRCLE_DROPDOWN, gesture: null, value: null,
      expectedState: state(["相切,相切,半径"], "下拉菜单展开", "菜单展开"),
      canvasChange: menuOpen(null), sourceEventIds: evidence.dropdown, confidence: 0.85
    },
    {
      id: "x", goal: `选择“相切,相切,半径”画圆方式`, action: "click",
      target: MENU_TTR, gesture: null, value: null,
      expectedState: state(
        ["指定对象与圆的第一个切点", "_ttr"],
        "命令行出现 _circle _ttr 提示", "CIRCLE TTR 命令激活"
      ),
      canvasChange: noChange, sourceEventIds: evidence.dropdown, confidence: 0.85
    },
    {
      id: "x", goal: `在${leftDesc}上拾取第一个相切对象`, action: "click",
      target: {
        semanticFunction: "canvas.tangent-object-1", role: "canvas_position",
        textCandidates: [], visualDescription: `${leftDesc}的右下弧段(递延切点标记出现)`,
        expectedRegion: "canvas", relativePositionFallback: leftAt
      },
      gesture: null, value: null,
      expectedState: state(["指定对象与圆的第二个切点"], "第一个相切对象高亮", "第一切点已指定"),
      canvasChange: noChange, sourceEventIds: evidence.pick1, confidence: 0.8
    },
    {
      id: "x", goal: `在${rightDesc}上拾取第二个相切对象`, action: "click",
      target: {
        semanticFunction: "canvas.tangent-object-2", role: "canvas_position",
        textCandidates: [], visualDescription: `${rightDesc}的左下弧段`,
        expectedRegion: "canvas", relativePositionFallback: rightAt
      },
      gesture: null, value: null,
      expectedState: state(["指定圆的半径"], "命令行提示输入半径,默认值 <10000.0000>", "第二切点已指定"),
      canvasChange: noChange, sourceEventIds: evidence.pick2, confidence: 0.8
    },
    {
      id: "x", goal: `接受默认半径 10000,生成${name}`, action: "press_key",
      target: null, gesture: null, value: "ENTER",
      expectedState: state([], `底排出现${name},与上方两圆同时相切`, `${name}已创建`),
      canvasChange: {
        detected: true, changeType: "create",
        objectDescription: `${name}: 半径 10000 的圆,位于${leftDesc}与${rightDesc}下方,与两者同时外切`,
        beforeScreenshot: screenshots.before ?? null, afterScreenshot: screenshots.after ?? null,
        changedRegionRelative: null,
        measurements: [{ name: "radius", value: 10000, unit: "drawing_unit", confidence: 0.9 }]
      },
      sourceEventIds: evidence.confirm, confidence: 0.85
    }
  ];
}

const workflow = {
  summary:
    "在 AutoCAD 中绘制奥运五环样式图形: 顶排三个圆用“两点(2P)”方式各以直径 20000 相切排列," +
    "底排两个圆用“相切,相切,半径(TTR)”方式与相邻顶圆相切、半径 10000。",
  steps: [
    ...twoPointCircle(1,
      {
        semanticFunction: "canvas.free-point", role: "canvas_position", textCandidates: [],
        visualDescription: "画布空白区域中部偏左,作为首圆直径左端点", expectedRegion: "canvas",
        relativePositionFallback: rel(748, 368)
      },
      { fromRelative: rel(748, 368), toRelative: rel(848, 368), pathRelative: [] },
      { dropdown: ["in-0163", "act-0536", "act-0537"], pick: ["in-0164", "act-0538"],
        value: ["in-0165", "act-0539"], pickConfidence: 0.8 },
      { after: "slices/act-0539_after.jpg" }),
    ...twoPointCircle(2,
      {
        semanticFunction: "canvas.osnap-quadrant", role: "canvas_position", textCandidates: ["象限点", "切点"],
        visualDescription: "圆1的最右点(对象捕捉标记),作为圆2直径左端点以保证相切", expectedRegion: "canvas",
        relativePositionFallback: rel(691, 386)
      },
      { fromRelative: rel(691, 386), toRelative: rel(791, 386), pathRelative: [] },
      { dropdown: ["in-0166", "act-0546", "act-0547"], pick: ["in-0167", "act-0548"],
        value: ["in-0168", "act-0549"], pickConfidence: 0.8 },
      { after: "slices/act-0549_after.jpg" }),
    ...twoPointCircle(3,
      {
        semanticFunction: "canvas.osnap-quadrant", role: "canvas_position", textCandidates: ["象限点", "切点"],
        visualDescription: "圆2的最右点(对象捕捉标记),作为圆3直径左端点", expectedRegion: "canvas",
        relativePositionFallback: rel(686, 379)
      },
      { fromRelative: rel(686, 379), toRelative: rel(786, 379), pathRelative: [] },
      { dropdown: ["in-0169", "act-0560", "act-0561"], pick: ["in-0170", "act-0567"],
        value: ["act-0566"], pickConfidence: 0.7 },
      { after: "slices/act-0567_after.jpg" }),
    ...ttrCircle(4, "圆1", "圆2", rel(600, 420), rel(720, 420),
      { dropdown: ["act-0567"], pick1: ["act-0563", "act-0564"], pick2: ["act-0565", "act-0566"],
        confirm: ["in-0171", "act-0568"] },
      { after: "slices/act-0568_after.jpg" }),
    ...ttrCircle(5, "圆2", "圆3", rel(720, 420), rel(840, 420),
      { dropdown: ["in-0172", "act-0577"], pick1: ["act-0572"], pick2: ["act-0574", "act-0575"],
        confirm: ["in-0173", "act-0582"] },
      { after: "slices/act-0582_after.jpg" })
  ],
  omitted: [
    {
      sourceEventIds: ["in-0157", "in-0158", "in-0159", "in-0161", "in-0162",
        "act-0515", "act-0523", "act-0526", "act-0529", "act-0532"],
      reason: "讲师先以直径 10000 试画并两次删除重画(命令行 736s/754s 出现 _erase),对最终图形无贡献",
      confidence: 0.85
    },
    {
      sourceEventIds: ["in-0174", "in-0175", "in-0176", "in-0177", "in-0178", "in-0179",
        "in-0180", "in-0181", "in-0182", "act-0596", "act-0608", "act-0622", "act-0631"],
      reason: "819-885s 用 3P+切点捕捉与 TTR 追加的演示圆随后被删除(866s Delete、877s _erase),不属于最终五环",
      confidence: 0.8
    },
    {
      sourceEventIds: ["act-0592", "act-0593", "act-0594", "act-0595"],
      reason: "讲师荧光笔标注特效造成的画面变化,非软件操作",
      confidence: 0.9
    }
  ],
  warnings: [
    "736-790s 讲师多次取消/删除重画,该区间单步事件归属为近似对应,不影响最终几何",
    "顶排三圆的相切依赖第一端点捕捉到前圆最右点;若 Mock 不支持对象捕捉,可按圆心间距 20000 直接定位",
    "2P 第二端点采用“方向+距离”输入,方向为正右,由拖动预览方向推断(置信度 0.8)",
    "TTR 半径 10000 来自命令行默认值 <10000.0000> 回车接受,未显式输入"
  ]
};

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, "out", "rings_generated");
await fs.mkdir(outDir, { recursive: true });
const plan = validateWorkflow(workflow, { minimumConfidence: 0.65 });
await fs.writeFile(path.join(outDir, "semantic-trace.json"), JSON.stringify(plan, null, 2));
await fs.writeFile(path.join(outDir, "mock-script.ts"), renderTypeScript(plan));
await fs.writeFile(path.join(outDir, "computer-use-task.md"), renderComputerUseTask(plan));
console.log(`steps=${plan.steps.length} warnings=${plan.warnings.length} -> ${outDir}`);
