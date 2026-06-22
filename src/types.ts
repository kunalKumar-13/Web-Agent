/**
 * Typed contracts shared across the three layers (perceive → decide → act).
 *
 * The detector emits a `PageSnapshot`, a `Planner` turns (snapshot, goal) into
 * a list of `Action`s, and the agent executes those actions. Nothing else is
 * shared between the layers — these interfaces are the only coupling.
 */

/** Viewport-relative geometry for one element (pixels). */
export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

/** One interactive element, as perceived by the detector. */
export interface ElementInfo {
  /** Stable agent index; also written to the DOM as `data-agent-idx`. */
  idx: number;
  /** Stable selector derived from the index: `[data-agent-idx="N"]`. */
  selector: string;
  tagName: string;
  /** Input/button `type` attribute, lower-cased ('' if none). */
  type: string;
  /** ARIA role, if any. */
  role: string;
  /** Resolved human label (for/wrapping/aria-labelledby/aria-label/container). */
  label: string;
  placeholder: string;
  /** `name` attribute. */
  name: string;
  /** Visible text / value (truncated) — useful for buttons. */
  text: string;
  /** Index of the owning <form> (-1 if the element is not inside a form). */
  formIndex: number;
  /** True for single-line text-like inputs / textbox / contenteditable. */
  isTextInput: boolean;
  isTextarea: boolean;
  isButton: boolean;
  visible: boolean;
  box: BoundingBox;
}

/** A structured, form-scoped perception of the page at one moment. */
export interface PageSnapshot {
  url: string;
  title: string;
  viewport: { width: number; height: number };
  scrollX: number;
  scrollY: number;
  formCount: number;
  elements: ElementInfo[];
}

/** What the agent is trying to accomplish. */
export interface Goal {
  /** Value for the primary single-line field (name/title/subject). */
  primaryValue: string;
  /** Value for the description field (textarea). */
  descriptionValue: string;
  /** Whether to submit after filling. */
  submit: boolean;
  /** Human-readable task description (used in the AI prompt). */
  taskDescription: string;
}

/**
 * The action vocabulary — a discriminated union. Targeted actions reference an
 * element by `idx`; the agent resolves that to fresh coordinates just before
 * acting. Both planners emit exactly these shapes.
 */
export type Action =
  | { type: 'click'; idx: number; reason: string }
  | { type: 'double_click'; idx: number; reason: string }
  | { type: 'type'; idx: number; text: string; reason: string }
  | { type: 'scroll'; direction: 'up' | 'down'; amount?: number; reason: string }
  | { type: 'wait'; ms: number; reason: string }
  | { type: 'done'; reason: string };

/** Action type strings, handy for validation in the AI planner. */
export const ACTION_TYPES = ['click', 'double_click', 'type', 'scroll', 'wait', 'done'] as const;

/** Result of the post-submit success check. */
export interface VerifyResult {
  success: boolean;
  detail: string;
}
