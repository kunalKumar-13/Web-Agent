# Architecture Document - Website Automation Agent

This document details the architectural design, component structure, and operational workflow of the **Website Automation Agent**.

---

## 1. System Overview

The Website Automation Agent is a modular, TypeScript-based browser automation program. It interacts with websites using two core execution loops:
1. **AI-Driven Loop**: Captures screenshots, highlights interactive elements, and sends them to Gemini 2.5 Flash to make logical agent actions.
2. **Heuristic Loop**: Operates on a semantic, weighted-scoring rule engine that parses DOM attributes (labels, placeholders, names, tags) to target specific form fields and submit them autonomously.

```
   ┌──────────────────────────────────────────────────────────┐
   │                       CLI ENTRYPOINT                     │
   │                        (src/index.ts)                    │
   └─────────────────────────────┬────────────────────────────┘
                                 │
                   ┌─────────────┴─────────────┐
                   ▼                           ▼
        ┌─────────────────────┐     ┌─────────────────────┐
        │       AI MODE       │     │   HEURISTIC MODE    │
        │   (Gemini + Vision) │     │ (Weighted DOM Rules)│
        └──────────┬──────────┘     └──────────┬──────────┘
                   │                           │
                   └─────────────┬─────────────┘
                                 ▼
                    ┌─────────────────────────┐
                    │    AGENT ORCHESTRATOR   │
                    │      (src/agent.ts)     │
                    └────────────┬────────────┘
                                 │
        ┌────────────────────────┼────────────────────────┐
        ▼                        ▼                        ▼
┌──────────────┐         ┌──────────────┐         ┌──────────────┐
│ BROWSER MGR  │         │   DETECTOR   │         │ VISUALBadges │
│(src/browser) │         │(src/detector)│         │(src/detector)│
└──────────────┘         └──────────────┘         └──────────────┘
```

---

## 2. Core Modules & Component Responsibilities

### 2.1 CLI Entry Point (`src/index.ts`)
- Manages command-line argument parsing (target URL, headless/headed browser execution, maximum steps, and execution modes).
- Resolves configuration and handles environment configuration loading (`dotenv`).
- Automatically falls back from `AI` to `Heuristic` mode if the required `GEMINI_API_KEY` is not present in `.env`, ensuring out-of-the-box reliability.

### 2.2 Browser Manager (`src/browser.ts`)
- Wraps Playwright's Chromium control to expose modular browser actions:
  - `openBrowser()` / `closeBrowser()`
  - `navigateToUrl(url)`
  - `takeScreenshot(path)`
  - `clickOnScreen(x, y)` & `clickElement(selector)` (Supports coordinate-based and CSS selector-based clicking)
  - `sendKeys(text)` & `typeInto(selector, text)` (Supports standard keyboard typing and element typing)
  - `scroll(direction)`
  - `doubleClick(x, y)`
- **Robustness (Retries)**: Implements an exponential backoff retry utility `retry(fn, retries)` for network-bound and UI-bound tasks (navigation, screenshotting, and typing).
- **Visual Micro-animations**: Injects a temporary red pulse cursor ripple directly at click coordinates on the webpage before executing clicks. This makes the execution highly visible and engaging in headed mode.

### 2.3 Element Detector & Badge System (`src/detector.ts`)
- Executes light DOM traversal inside the browser context to find all visible, interactable elements (`input`, `textarea`, `select`, `button`, `a`, elements with pointer cursors, etc.).
- **Label Association**: Resolves field labeling by querying associated `<label>` tags (by ID, parent containers, or layout container structures like shadcn's form spacing classes).
- **Visual Overlay System (`drawBadges()`)**: Injects numeric badge overlays directly on top of detected elements during screenshot capture. This translates the visual viewport state into indexed inputs for the multimodal AI model.

### 2.4 Agent Orchestrator (`src/agent.ts`)
#### The Heuristic Algorithm
Computes weighted scores for all interactive DOM elements to target specific form controls:
- **Name/Username**:
  - `+30` if label matches `username`
  - `+20` if label matches `name`
  - `+25` / `+15` for placeholder matching
  - `+20` / `+10` for attribute matching (id, name)
- **Description**:
  - `+10` if element is a `textarea` (preferred control)
  - `+30` if label matches `description`/`desc`
  - `+25` if label matches `bio`/`about`
  - Similar weight bonuses for placeholders and names.
- **Submit Button**:
  - `+30` if button text contains `submit`
  - `+20` if text matches `create`/`save`/`send`

#### The AI Decision Loop
- Prompts Gemini 2.5 Flash using multimodal inputs: the current badge-overlayed screenshot and a JSON list of detected elements.
- Uses Gemini's JSON schema output configuration (`responseMimeType: "application/json"`) to receive structured actions.
- Features parsing safeguards: if the AI returns malformed JSON, the execution immediately falls back to the Heuristic engine for that step to prevent crashes.

---

## 3. Design Decisions & Trade-offs

1. **Selector-based vs Coordinates-based Actions**: The agent supports both. While coordinates satisfy the baseline assignment spec and match the AI's visual reasoning, selector-based typing and clicking provide rock-solid reliability against network lag and page reflows.
2. **TypeScript & modularity**: Using strict TypeScript ensures that elements, actions, and configurations conform to interfaces, making the code extremely readable, maintainable, and robust.
3. **Chalk Logger**: Uses custom logging schemes (Thinking = Blue, Success = Green, Errors = Red, Actions = Cyan) to output an interactive, beautiful terminal log in real-time.
