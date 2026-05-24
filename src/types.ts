export interface InteractiveElement {
  id: number;
  selector: string;
  tagName: string;
  type: string;
  text: string;
  placeholder: string;
  name: string;
  idAttribute: string;
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  label: string;
}

export interface AgentAction {
  action: 'click' | 'double_click' | 'type' | 'scroll' | 'wait' | 'complete';
  elementId?: number;
  text?: string;
  x?: number;
  y?: number;
  reason: string;
}

export interface AgentConfig {
  headless: boolean;
  mode: 'ai' | 'heuristic';
  maxSteps: number;
  url: string;
}

export interface StepLog {
  step: number;
  action: string;
  reason: string;
  screenshotPath?: string;
}
