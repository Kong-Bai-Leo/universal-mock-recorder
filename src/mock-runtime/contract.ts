export type MockTarget = {
  semanticFunction?: string | null;
  role?: "button" | "menu_item" | "input" | "canvas_position" | "other";
  textCandidates?: readonly string[];
  visualDescription?: string | null;
  expectedRegion?: string | null;
  matchMethod?: "exact" | "closest_candidate" | "visual_only" | "none";
  knowledgeReference?: string | null;
  relativePositionFallback?: readonly [number, number] | null;
};

export type ExpectedState = {
  visibleTextCandidates?: readonly string[];
  visualDescription?: string | null;
  stateChange?: string | null;
};

export type MockGesture = {
  fromRelative: readonly [number, number] | null;
  toRelative: readonly [number, number] | null;
  pathRelative: readonly (readonly [number, number])[];
};

export type CanvasMeasurement = {
  name: string;
  value: number;
  unit: string;
  confidence: number;
};

export type CanvasChange = {
  detected: boolean;
  changeType: "create" | "delete" | "move" | "resize" | "rotate" | "modify" | "selection" | "view" | "none" | "unknown";
  objectDescription: string | null;
  beforeScreenshot: string | null;
  afterScreenshot: string | null;
  changedRegionRelative: readonly [number, number, number, number] | null;
  measurements: readonly CanvasMeasurement[];
};

export type MockStep = {
  id: string;
  goal: string;
  action:
    | "click"
    | "double_click"
    | "right_click"
    | "middle_click"
    | "drag"
    | "scroll"
    | "type_text"
    | "press_key"
    | "wait";
  target?: MockTarget | null;
  gesture: MockGesture | null;
  value?: unknown;
  expectedState: ExpectedState;
  canvasChange: CanvasChange;
  sourceEventIds: readonly string[];
  confidence: number;
};

export type CadPoint = {
  x: number;
  y: number;
  snap: "none" | "endpoint" | "center" | "intersection" | "midpoint" | "quadrant" |
    "perpendicular" | "tangent" | "nearest" | "unknown";
  referenceEntityIds: readonly string[];
  confidence: number;
};

export type CadSelection = {
  mode: "last" | "previous" | "window" | "crossing" | "entities" | "all";
  entityIds: readonly string[];
  firstCorner: CadPoint | null;
  secondCorner: CadPoint | null;
};

export type CadArgument = {
  kind: "point" | "number" | "integer" | "keyword" | "text" | "enter" | "selection";
  name: string;
  point: CadPoint | null;
  number: number | null;
  text: string | null;
  selection: CadSelection | null;
};

export type CadVisualInference = {
  method: "none" | "before_after_diff" | "combined";
  beforeScreenshot: string | null;
  afterScreenshot: string | null;
  changedRegionRelative: readonly [number, number, number, number] | null;
  sourceEntityIds: readonly string[];
  referenceEntityIds: readonly string[];
  side: "none" | "left" | "right" | "inside" | "outside" | "both" | "unknown";
  confidence: number;
};

export type CadResultGeometry = {
  id: string;
  kind: "line" | "polyline" | "circle" | "arc_3point" | "arc_center";
  points: readonly CadPoint[];
  center: CadPoint | null;
  radius: number | null;
  startAngle: number | null;
  endAngle: number | null;
  clockwise: boolean | null;
  closed: boolean;
  sourceEntityIds: readonly string[];
  confidence: number;
};

export type CadOperation = {
  id: string;
  semanticKind: "command" | "circle" | "line" | "polyline" | "arc_3point" |
    "offset" | "trim" | "polar_array" | "linear_constraint" | "other";
  command: string;
  arguments: readonly CadArgument[];
  resultEntityIds: readonly string[];
  resultGeometry: readonly CadResultGeometry[];
  visualInference: CadVisualInference;
  sourceEventIds: readonly string[];
  sourceScreenshots: readonly string[];
  confidence: number;
};

export type CadProgram = {
  format: "autocad_command_ir" | "none";
  operations: readonly CadOperation[];
  confidence: number;
  warnings: readonly string[];
  complete: boolean;
};

export type AnalysisCommandState = {
  status: "idle" | "active" | "deferred" | "cancelled" | "unknown";
  activeCommand: string | null;
  stage: string | null;
  pendingParameter: string | null;
  visiblePrompt: string | null;
  lastCompletedCommand: string | null;
  evidenceEventIds: readonly string[];
  confidence: number;
};

export type MockWorkflow = {
  summary: string;
  steps: readonly MockStep[];
  omitted?: readonly unknown[];
  commandState?: AnalysisCommandState;
  cadProgram?: CadProgram;
  warnings?: readonly string[];
};

export type RunOptions = {
  locateOrder: readonly ("semantic" | "accessibility" | "text" | "visual" | "relative_position")[];
  preferStructuredCadProgram: boolean;
  verifyAfterEachStep: boolean;
  retryCandidates: boolean;
  recoverWithEscapeOrUndo: boolean;
};

export interface MockAgent {
  run(workflow: MockWorkflow, options: RunOptions): Promise<void>;
}

export declare function createMockAgent(): Promise<MockAgent>;
