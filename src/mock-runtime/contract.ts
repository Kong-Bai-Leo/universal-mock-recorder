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
  value?: unknown;
  expectedState: ExpectedState;
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
