# Website Automation Agent

An intelligent, autonomous website automation agent capable of navigating web pages, scanning DOM layouts, rendering numbered interactive overlays, and filling out forms. 

Designed for demonstration during viva voce, the project supports a **Dual-Execution Engine**:
1. **AI-Driven Engine**: Uses visual screenshot reasoning and element lists with Gemini 2.5 Flash to dynamically make browser actions.
2. **Heuristic Engine (Fallback)**: A rule-based scoring crawler that parses semantic fields and completes the target form task autonomously out-of-the-box, even without an LLM API key.

---

## Key Features

* **Visual Element Badging**: Injects high-contrast numbered badges over interactable elements, matching screenshots.
* **Micro-Click Animations**: Visual cursor ripple effect at target coordinates before clicking.
* **Selector-Based Actions**: Combines visual coordinate tracking with stable selector-based execution to prevent failure on page reflows.
* **Fail-Safe Robustness**: Try-catch wrapper around AI JSON parser that automatically delegates to Heuristic mode if parsing fails.
* **Task Retries**: Retry logic wrapper with exponential backoff for network navigation, typing, and screenshot capture.
* **Step-by-step Log Retention**: Saves full page screenshots per interaction step in `/screenshots`.

---

## Project Structure

```
Website-Agent/
├── src/
│   ├── types.ts          # TypeScript interfaces (Elements, Actions, Log structures)
│   ├── browser.ts        # Playwright browser manager (retries, click animations, selectors)
│   ├── detector.ts       # DOM element extraction and badge overlays drawing
│   ├── agent.ts          # Core execution loop orchestrator (AI and Heuristic Engine)
│   └── index.ts          # CLI entry point (commander configuration)
├── docs/
│   └── architecture.md   # Architectural design document
├── screenshots/          # Retention directory for interaction steps screenshots
├── tsconfig.json         # TypeScript compiler configurations
├── package.json          # Dependency and script manager
├── .env.example          # Environment variables template
└── .env                  # Environment variables config
```

---

## Getting Started

### Prerequisites
Make sure you have [Node.js](https://nodejs.org/) installed.

### 1. Installation
Clone the repository and install the dependencies:
```bash
# Install NPM packages
npm install

# Download Playwright Chromium browser binary
npx playwright install chromium
```

### 2. Configuration
Copy the template `.env.example` to `.env`:
```bash
cp .env.example .env
```
Open `.env` and configure:
* `GEMINI_API_KEY`: *(Optional)* Your Gemini API key from [Google AI Studio](https://aistudio.google.com/). If left empty, the agent automatically falls back to Heuristic Mode.
* `HEADLESS`: Set to `false` to watch the browser actions live on your desktop.
* `MAX_STEPS`: Max step iterations for the AI execution loop.

---

## Running the Agent

You can run the agent in either **Heuristic** or **AI** mode using the scripts defined in `package.json`:

### Run in Heuristic Mode (Out-of-the-box reliable)
Uses weighted DOM matching rules to complete the form filling.
```bash
npm run test:heuristic
```

### Run in AI Mode (Requires GEMINI_API_KEY)
Uses multimodal screenshots + element lists to execute via Gemini.
```bash
npm run test:ai
```

### Advanced Usage (CLI Commands)
Run the CLI tool directly with custom options:
```bash
npx ts-node src/index.ts --mode heuristic --url https://ui.shadcn.com/docs/forms/react-hook-form --headless false
```
* Options:
  * `-m, --mode <mode>`: `ai` or `heuristic` (default: `heuristic`)
  * `-u, --url <url>`: Navigation target URL
  * `-h, --headless <boolean>`: Runs headless browser if set to `true` (default: `false`)
  * `-s, --steps <number>`: Limit max step loop (default: `10`)
