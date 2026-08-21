export type MockTarget = {
  semanticFunction?: string | null;
  role?: "button" | "menu_item" | "input" | "canvas_position" | "other";
  textCandidates?: readonly string[];
  visualDescription?: string | null;
  expectedRegion?: string | null;
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

export type MockWorkflow = {
  summary: string;
  steps: readonly MockStep[];
  omitted?: readonly unknown[];
  warnings?: readonly string[];
};

export type RunOptions = {
  locateOrder: readonly ("semantic" | "accessibility" | "text" | "visual" | "relative_position")[];
  verifyAfterEachStep: boolean;
  retryCandidates: boolean;
  recoverWithEscapeOrUndo: boolean;
};

export interface MockAgent {
  run(workflow: MockWorkflow, options: RunOptions): Promise<void>;
}

export declare function createMockAgent(): Promise<MockAgent>;
