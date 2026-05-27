# LLM Council

A static web app for running a council-style decision review:

1. Independent advisor responses
2. Anonymous peer review
3. Chair verdict with dissent, blind spots, confidence, and next action

The first build is intentionally GitHub Pages friendly. It runs locally in the browser with a deterministic mock council so the product shape is usable before wiring paid model calls.

## Personas

Council personas live in `public/personas/*.md`.

Each file uses frontmatter:

```md
---
name: Contrarian
stance: Find the fatal flaw before enthusiasm hardens into plan.
objective: Identify what could fail.
review_focus: Reward answers that expose hidden risk.
---
```

To create a new persona:

1. Add a Markdown file in `public/personas`.
2. Add it to `public/personas/manifest.json`.
3. Set its `domain` to `general`, `software`, or `trading`.

## Presets

- General: Contrarian, First Principles, Expansionist, Outsider, Executor
- Software Engineering: Architect, Maintainer, Security and Reliability, Product Engineer, Engineering Executor
- Swing Trading: Bull Case, Bear Case, Risk Manager, Market Technician, Trading Executor

Trading mode is a decision-quality review, not financial advice or an automated signal generator.

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Deploy

GitHub Actions builds and deploys `dist` to GitHub Pages when commits land on `main`.
