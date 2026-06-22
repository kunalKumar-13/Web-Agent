# Website Automation Agent

An intelligent website-automation agent built with **TypeScript + Playwright**. It opens a browser,
**perceives** a page into a structured model, **decides** what to do, and **acts** — autonomously filling
and submitting a form. A mini *Browser Use*, with a clean perceive → decide → act architecture.

> **Target task:** open <https://ui.shadcn.com/docs/forms/react-hook-form>, find the name/title and
> description fields, fill them, and submit. The page renders **9 example forms**, so the agent must pick
> the right one — it does this by *form-scoped role matching*, not by hardcoding field names. (The intended
> form is the "Bug Report" demo: a **Bug Title** input + a **Description** textarea + a **Submit** button.)

✅ **Verified end-to-end:** both `npm run test:heuristic` and `npm run test:ai` (Groq) fill the correct form
and submit, and the agent confirms the success toast (`"You submitted the following values: …"`). Exit code
is `0` on confirmed success, non-zero otherwise.

---

## Architecture: perceive → decide → act

```
          ┌──────────────┐   PageSnapshot   ┌──────────────┐   Action[]   ┌──────────────┐
  DOM ──▶ │  detector.ts │ ───────────────▶ │   planner    │ ───────────▶ │   agent.ts   │ ──▶ tools/ ──▶ page
          │  (PERCEIVE)  │                  │  (DECIDE)    │              │   (ACT)      │
          └──────────────┘                  └──────────────┘              └──────────────┘
                                            heuristic | ai                JIT coordinate
                                            (same interface)              resolution
```

The three layers are coupled **only** by typed contracts in [src/types.ts](src/types.ts)
(`PageSnapshot`, `ElementInfo`, `Action`, `Goal`). The two planners implement one `Planner` interface, so
switching brains (`--mode heuristic` ↔ `--mode ai`) is a single factory decision and the execution loop is
identical. AI mode is itself **provider-agnostic** (Groq by default, Gemini optional) behind an `LlmClient`
seam — see [AI mode](#ai-mode-provider-agnostic).

---

## The seven tools

Composable primitives in [src/tools/](src/tools/). The agent builds **all** behaviour by sequencing them.
`click_on_screen` and `double_click` are **genuine coordinate** mouse ops via Playwright `page.mouse`.

| Tool | File | Notes |
| --- | --- | --- |
| `open_browser` | [tools/browser.ts](src/tools/browser.ts) | launch Chromium + context/page |
| `navigate_to_url` | [tools/navigation.ts](src/tools/navigation.ts) | waits for network-idle (client-rendered) |
| `take_screenshot` | [tools/screenshot.ts](src/tools/screenshot.ts) | viewport PNG into `output/` |
| `click_on_screen(x, y)` | [tools/mouse.ts](src/tools/mouse.ts) | `page.mouse.click` |
| `double_click(x, y)` | [tools/mouse.ts](src/tools/mouse.ts) | `page.mouse.dblclick` |
| `send_keys` | [tools/keyboard.ts](src/tools/keyboard.ts) | types into the focused element |
| `scroll` | [tools/scroll.ts](src/tools/scroll.ts) | direction-aware wheel scroll |

Every tool is wrapped by `logger.step()`, so each call is timed and recorded in the audit trail.

---

## What makes it intelligent

1. **Form-scoped perception.** [detector.ts](src/detector.ts) emits one record per element, each tagged
   with a `data-agent-idx` (reused as a stable selector) and the **`formIndex`** of its owning `<form>`.
2. **Role-based matching, not hardcoding.** The heuristic planner groups fields by form and fills two
   roles — **primary** (single-line: name/title/subject…) and **description** (textarea preferred) — by
   keyword **and** element shape. "Bug Title" satisfies the primary role without any form name being hardcoded.
3. **Best-form selection.** Each form is scored on how completely and distinctly it fills both roles; the
   best one wins (out of 9 here).
4. **Submit may live outside the form.** If no submit button is inside the chosen `<form>`, the planner
   picks the nearest qualifying button by **geometric proximity** to the fields (true on this page).
5. **Just-in-time coordinate resolution.** Coordinates go stale after scrolling, so before every action the
   agent re-resolves: selector → `scrollIntoViewIfNeeded` → **fresh** bounding box → centre → real click.
6. **Purposeful `double_click`.** Used to focus a field and select existing content before retyping (not a
   throwaway call); the `type` step relies on that focus.
7. **Success verification.** After submit it waits for a sonner/radix toast or confirmation text and records
   what it found.

---

## Project structure

```
src/
  index.ts          # CLI: parse flags → build config → run agent
  config.ts         # one typed config (.env defaults, CLI overrides)
  logger.ts         # leveled console + structured run-log.json audit trail
  types.ts          # PageSnapshot, ElementInfo, Action (union), Goal
  detector.ts       # PERCEIVE: DOM → form-scoped snapshot
  agent.ts          # ACT: loop + just-in-time coordinate resolution
  tools/            # the 7 primitives + barrel
  planners/         # DECIDE: Planner interface + Heuristic + AI + factory
docs/architecture.md
```

---

## Setup

```bash
npm install
npx playwright install chromium
```

Optional `.env` (the agent runs in heuristic mode with no config at all):

```bash
cp .env.example .env   # set GROQ_API_KEY (or GEMINI_API_KEY) only if you want --mode ai
```

---

## Usage

```bash
npm run test:heuristic    # fill + submit the right form (no API key needed)
npm run demo              # same, but visible window + slow-mo
npm run test:ai           # AI planner (Groq by default; needs GROQ_API_KEY)
npm test                  # offline unit tests for the AI JSON-validator (no key)
npm run typecheck         # strict TS, passes clean
```

Direct CLI:

```bash
npx ts-node src/index.ts --mode heuristic --headless false -n "My Title" -d "My description"
```

| Flag | Meaning | Default |
| --- | --- | --- |
| `-m, --mode <m>` | `heuristic` or `ai` | `heuristic` |
| `-p, --provider <p>` | AI backend: `groq` or `gemini` | `groq` |
| `-u, --url <url>` | target URL | shadcn react-hook-form page |
| `-n, --name <text>` | primary (name/title) value | `Automated Test Entry` |
| `-d, --description <text>` | description value | a short default sentence |
| `--headless [bool]` | headless browser (`--headless false` shows window) | `true` |
| `--out <dir>` | output directory | `output` |
| `--timeout <ms>` | navigation/element timeout | `45000` |
| `--slowmo <ms>` | delay between ops (demos) | `0` |
| `-v, --verbose` | debug logging | off |

> There is intentionally **no `-h`** short flag — commander reserves it for `--help`.

---

## How it works (run sequence)

```
open_browser → navigate_to_url → screenshot(loaded)
  → perceive() → planner.plan(snapshot, goal)
  → for each action: resolve fresh coords → tool → screenshot
      double_click(title) → type(title) → double_click(desc) → type(desc) → click(submit) → wait
  → verify success toast → screenshot(final) → flush run-log.json → close_browser
```

Heuristic mode returns the whole plan in one pass; AI mode loops perceive → plan → act until `done` or
`--steps`. See [docs/architecture.md](docs/architecture.md) for the full design.

---

## Outputs (`output/`)

- `NN-<action>.png` — a screenshot after every step (filmstrip)
- `NN-final.png` — final state, showing the success toast ✅
- `run-log.json` — structured audit trail: every tool call (timed), every action, and the verify result

---

## AI mode (provider-agnostic)

Pick the LLM backend with `LLM_PROVIDER` (or `--provider`); both use Node's built-in `fetch`, **no SDKs**:

| Provider | Endpoint | Default model | Key |
| --- | --- | --- | --- |
| **groq** (default) | OpenAI-compatible `chat/completions` | `llama-3.3-70b-versatile` | `GROQ_API_KEY` (free at [console.groq.com](https://console.groq.com)) |
| **gemini** | Google Generative Language REST (`x-goog-api-key` header) | `gemini-3.5-flash` | `GEMINI_API_KEY` |

The planner builds one prompt (indexed element list + goal), asks the model for a JSON-array action plan, and
**validates** the response — dropping unknown action types / out-of-range indices, tolerating code fences or a
`{actions:[…]}` wrapper, and failing loudly on non-JSON. The validator has **offline unit tests**
(`npm test`) so parsing is covered without any key.

✅ **Verified live with Groq** (`llama-3.3-70b-versatile`): the model independently chose the Bug Title +
Description + Submit elements, and the run confirmed the success toast. The model's action plan is recorded in
`output/run-log.json`.

Switch providers:
```bash
LLM_PROVIDER=gemini npm run test:ai
# or: npx ts-node src/index.ts --mode ai --provider gemini
```

> The Gemini path is fully intact. Note: a Gemini key whose Google Cloud project lacks `generateContent`
> quota returns HTTP 403/429 — use Groq (default) or a billing-enabled Gemini key.

---

## Troubleshooting

- `Executable doesn't exist` → `npx playwright install chromium`.
- AI mode error about a missing key → set `GROQ_API_KEY` (or `GEMINI_API_KEY` with `LLM_PROVIDER=gemini`), or use `--mode heuristic`.
- Watch it live → `npm run demo` (or `--headless false`).
