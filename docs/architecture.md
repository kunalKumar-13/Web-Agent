# Architecture — Website Automation Agent

Design decisions, component responsibilities, and the end-to-end run sequence.

---

## 1. The core idea: perceive → decide → act

The agent is three layers joined **only** by typed contracts in `src/types.ts`. Nothing else crosses the
boundaries, which keeps each layer independently testable and replaceable.

```
        PERCEIVE                         DECIDE                          ACT
   ┌────────────────┐   PageSnapshot ┌────────────────┐  Action[]  ┌────────────────┐
   │  detector.ts   │ ─────────────▶ │   Planner      │ ─────────▶ │   agent.ts     │
   │  DOM → model   │                │  heuristic|ai  │            │  loop + JIT    │
   └────────────────┘                └────────────────┘            └───────┬────────┘
                                                                            │ sequences
                                                                            ▼
                                                                   ┌────────────────┐
                                                                   │   tools/ (7)   │ ─▶ Chromium
                                                                   └────────────────┘
```

**Contracts** (`types.ts`): `PageSnapshot` (perception), `ElementInfo` (one element, incl. `formIndex`,
`box`, `selector`), `Action` (a discriminated union: `click | double_click | type | scroll | wait | done`),
and `Goal`. The planners consume a snapshot + goal and return actions; the agent executes them.

---

## 2. Modules

### `index.ts` — CLI
Parses flags with commander, builds the config, constructs the planner via the factory, and runs the agent.
Exits non-zero if success can't be confirmed. No `-h` short flag (commander reserves it for `--help`), so
headless is `--headless [bool]`.

### `config.ts` — configuration
One typed `AgentConfig`. Precedence: built-in defaults < `.env` (dotenv) < CLI flags. Output directory is
resolved against `process.cwd()` — never an absolute machine path — so it works on any OS.

### `logger.ts` — observability
Leveled, colour-coded console output (raw ANSI, no dependency) **and** a structured audit trail. `step()`
wraps each async tool call with timing + success/failure; `recordAction()` logs executed actions with their
screenshot; `flush()` writes `output/run-log.json`.

### `detector.ts` — PERCEIVE
Runs in the browser via `page.evaluate` and returns a `PageSnapshot`. For each visible interactive element it:
- writes a **`data-agent-idx`** attribute and uses `[data-agent-idx="N"]` as the element's stable selector,
- records the **`formIndex`** (`closest('form')`) so fields can be reasoned about per-form,
- resolves a label via `aria-labelledby` → `aria-label` → `label[for]` → wrapping `<label>` → shadcn
  form-item container,
- captures type/role/placeholder/name/text + a viewport-relative bounding box.

Tagging the DOM with a stable index is what makes just-in-time coordinate resolution possible later.

### `tools/` — ACT primitives
The seven required tools, each wrapped in `logger.step`. `click_on_screen` / `double_click` are **genuine**
`page.mouse` coordinate operations; `scroll` is a direction-aware `mouse.wheel`; `send_keys` types into the
focused element (with a `pressKey` helper for select-all). A barrel re-exports them.

### `planners/` — DECIDE
- `planner.ts` — the `Planner` interface: `plan(snapshot, goal) => Promise<Action[]>`.
- `heuristic.ts` — deterministic, form-scoped role matcher (below).
- `ai.ts` — Gemini via REST (below).
- `factory.ts` — chooses the planner from config (the only place the engine is selected).

### `agent.ts` — ACT orchestration
Owns the perceive → decide → act loop, just-in-time coordinate resolution, per-step screenshots, success
verification, and error handling.

---

## 3. Heuristic algorithm (form-scoped, role-based)

1. **Score roles** for every element:
   - *primary* (single-line text input): `+30/14/12` for name/title/subject/summary/username/headline in
     label/placeholder/name; `+2` base so any text input can serve.
   - *description* (`<textarea>` `+20` base, else text input `0`): `+30/14/12` for
     description/message/details/comment/body/about/bio/… in label/placeholder/name.
   - *submit* (button): `+30` "submit", `+18` save/send/create/…, `+20` `type=submit`; negatives
     (reset/cancel/clear/…) score `0` so the bug-report **Reset** button is never chosen.
2. **Group by `formIndex`** and pick the form that best fills **both** roles (distinct elements), with a
   bonus when both are present.
3. **Find submit:** prefer a submit inside the chosen form; otherwise the nearest qualifying button **below**
   the fields by geometric proximity (on this page the submit lives *outside* the `<form>`).
4. **Emit actions:** optional `scroll` if the form is below the fold, then per field
   `double_click` (focus + select) → `type`, then `click` submit → `wait` → `done`.

No specific form or field name is hardcoded — selection is purely by keyword + shape + geometry.

## 4. AI planner (REST, validated)

Serialises the indexed element list (`idx`, tag, type, role, label, placeholder, name, text, `formIndex`) +
the goal into a prompt and calls the Gemini REST endpoint with Node's built-in `fetch`
(`responseMimeType: application/json`, `temperature: 0`) — **no SDK dependency**. The response is parsed and
**validated**: each item must use a known action type with an in-range `idx`; invalid items are dropped and a
non-JSON response throws. It returns the same `Action[]` the agent executes for the heuristic planner.

---

## 5. Just-in-time coordinate resolution (the key reliability trick)

Coordinates captured during perception are viewport-relative and go stale the instant the page scrolls or
reflows. So `agent.ts` never reuses snapshot coordinates for the actual click. For every targeted action:

```
idx ──▶ selector ([data-agent-idx]) ──▶ locator.scrollIntoViewIfNeeded()
    ──▶ fresh locator.boundingBox() ──▶ centre (x, y) ──▶ page.mouse click/dblclick at (x, y)
```

Typing reuses the focus from the preceding `double_click` (purposeful), falling back to a coordinate click if
the field isn't focused, then select-all + `send_keys`.

---

## 6. End-to-end run sequence

```
open_browser
  → navigate_to_url → screenshot(01-loaded)
  → perceive() ──────────────── PageSnapshot (80 elements, 9 forms)
  → planner.plan() ──────────── Action[]
  → execute each (JIT resolve → tool → screenshot):
       scroll → double_click(title) → type(title)
              → double_click(desc)  → type(desc)
              → click(submit) → wait → done
  → verify() ────────────────── success toast text captured
  → screenshot(final) → flush run-log.json → close_browser
```

On any failure the agent captures an `error` screenshot, flushes the audit trail, and the process exits
non-zero.

---

## 7. Design decisions & trade-offs

1. **Form-scoped over global scoring** — the single most important correctness decision; it keeps the name
   and description in the *same* form and is why the agent picks the right one out of nine.
2. **One `Planner` interface for both engines** — heuristic for zero-setup reliability and as a deterministic
   safety net; AI for generality. The execution loop never changes between them.
3. **REST + `fetch` for Gemini, no SDK** — model SDKs churn and have shipped broken lockfiles; a thin REST
   call keeps dependencies to `playwright`, `commander`, `dotenv` only.
4. **Stable `data-agent-idx` selectors + JIT resolution** — robust against scroll/reflow without sacrificing
   genuine coordinate-based clicking.
5. **Audit trail + step filmstrip** — colour logs for a live demo; `run-log.json` + per-step screenshots for
   an auditable record.

## 8. Pitfalls explicitly avoided

- No hardcoded paths (output resolves against `process.cwd()`).
- No `-h` flag (collides with `--help`); headless is `--headless [bool]`.
- `scroll` respects direction; the AI planner is offered `double_click` and direction-aware `scroll` and
  parses them.
- Fields are scored **per form**, not globally.
- No SDK/unpublished deps for the model.
- The default description stays within the page's 100-character limit so submission validates.
