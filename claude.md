# Kalpa — Claude Code Guide

You are Claude Code working in this repository. Optimize for **safety, clarity, and maintainability** while helping evolve this project.

---

## Mission & Current State

Kalpa is an open-source desktop app for managing Elder Scrolls Online addons. It is currently in a **functional alpha** state with:

- Addon scanning and installation
- Updates and dependency resolution
- Backups and profiles
- Character management and API compatibility checks
- Minion migration support
- Pack Hub for community addon collections

Your job is to improve this app without breaking existing functionality or the build.

---

## Tech Stack Snapshot

- **Desktop client**: Tauri v2 + React 19 + TypeScript + Tailwind v4 + shadcn-ui
- **Backend**: Cloudflare Workers + KV (Pack Hub)
- **CI/CD**: GitHub Actions with tag-triggered release builds (Windows NSIS/MSI)

When in doubt, prefer solutions that fit naturally into this stack.

---

## Core Principles & Constraints

Follow these rules unless explicitly directed otherwise:

- **No private APIs or hacks**
  - Only use public ESOUI pages and direct public download URLs.
- **Centralized scraping**
  - Keep all scraping logic in `src-tauri/src/esoui.rs`.
- **No background spam**
  - Do not implement hourly or aggressive background scraping.
  - Use "on-open" refresh plus an explicit **Refresh** button.
- **Maintainability over cleverness**
  - Prefer straightforward, well-documented code over overly abstract solutions.
- **Build must always pass**
  - Keep the repo buildable and tests/linters passing after each change.

---

## Project Structure

Use the existing architecture; extend it instead of inventing new patterns:

```text
src/                    # React frontend
  components/           # Feature components (addon list, settings, etc.)
  components/ui/        # shadcn-ui primitives
  lib/                  # Utilities (store, helpers)
  types.ts              # Shared TypeScript interfaces

src-tauri/src/          # Rust backend
  commands.rs           # All Tauri command handlers
  esoui.rs              # ESOUI HTTP client & HTML scraping
  manifest.rs           # Addon manifest (.txt) parsing
  installer.rs          # ZIP extraction & addon installation
  metadata.rs           # Metadata caching & management
  lib.rs                # Module defs & Tauri app setup
```

When adding new logic, pick the closest existing file that matches the concern before creating new modules.

---

## Code Quality & Checks

**Rust**

- After editing Rust code, always run:
  1. `cargo clippy --fix --allow-dirty --allow-staged` (or similar clippy invocation)
  2. `cargo fmt`
- `cargo fmt` must run **after** clippy because clippy fixes can break formatting.

**Frontend**

- Run: `npm run check`
  - This runs TypeScript, ESLint, and Prettier.
- Fix all reported issues before considering the work complete.

**CI**

- GitHub Actions enforces Rust and frontend checks on every PR.
- Treat CI failures as blockers; update code until CI is green.

---

## Git Workflow & Releases

### Branching

Use **GitHub Flow**:

1. `main` is always releasable.
2. Create short-lived branches such as:
   - `feat/feature-name`
   - `fix/bug-name`
3. Open a PR, let CI pass, request review, then merge to `main`.
4. Tag releases from `main` (for example `v0.3.0`) to trigger release CI.

### Commit Messages

Use **Conventional Commits**:

- Format: `type(scope): description`
- Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`
- Use imperative mood, keep under ~50 characters, no trailing period.

### Release Process

When preparing a new release:

1. Bump the version in:
   - `tauri.conf.json`
   - `Cargo.toml`
   - `package.json`
2. Push a tag `v*` (for example `v0.3.0`).
3. `.github/workflows/release.yml` builds Windows NSIS/MSI installers and attaches them to GitHub Releases.

---

## Design System Essentials

The UI builds on the ESO Log Aggregator visual language, adapted to shadcn-ui and Tailwind v4. Respect the existing design system; do not introduce ad-hoc styles if a primitive exists.

### Reference Design Docs

Review these before UI work:

1. `context/40-design-system.md` — design principles, colors, glass morphism, typography, animations.
2. `context/41-component-patterns.md` — concrete shadcn component recipes.
3. `context/42-theme-tokens.md` — CSS variables, `@theme` inline mappings, Tailwind utilities.

### Implemented UI Primitives

Use these components instead of re-rolling new ones:

- `GlassPanel` (`components/ui/glass-panel.tsx`)
  - Variants: `primary`, `default`, `subtle`
- `SectionHeader` (`components/ui/section-header.tsx`)
  - Uppercase micro-label (11px, Space Grotesk)
- `InfoPill` (`components/ui/info-pill.tsx`)
  - Colors: `gold`, `sky`, `emerald`, `amber`, `red`, `violet`, `muted`

### Overridden shadcn Components

- `Input` — glass styling (translucent background, sky-blue focus ring)
- `Dialog` — glass morphism overlay with gradient background and gold gradient titles
- `Toaster` — glass-styled toasts

### Visual Rules

- Always-dark theme; no light mode.
- Glass morphism panels:
  - Three tiers: `primary`, `default`, `subtle`.
- Typography:
  - `Space Grotesk` (`font-heading`) for headings.
  - `Geist` (`font-sans`) for body text.
- Addon list items:
  - 3px colored left border encoding status.
- Borders and dividers:
  - Surfaces: `border-white/[0.06]` (not `border-border`).
  - Dividers: `<div className="border-t border-white/[0.06]" />` instead of `<Separator />`.
- Spinners:
  - Use `border-white/[0.1] border-t-[#c4a44a]` (ESO gold top border).
- Motion:
  - Timing scale: fast 150ms, normal 250ms, slow 400ms.
- Colors:
  - ESO gold `#c4a44a` as primary accent.
  - Sky-blue `#38bdf8` for interactive and focus states.

---

## How to Work in This Repo (Claude)

When performing changes, follow this workflow:

1. **Load context**
   - Skim the relevant `context/*.md` files for the area you are touching.
   - Always read `context/40-design-system.md` before any UI work.
2. **Clarify intent**
   - Restate the user's goal and constraints before proposing changes.
   - Prefer small, incremental improvements over broad refactors.
3. **Plan the change**
   - Identify which files you will touch (both Rust and React).
   - Check for existing patterns or utilities to reuse.
4. **Implement safely**
   - Keep changes small and reviewable.
   - Avoid introducing new dependencies unless necessary and clearly justified.
5. **Verify**
   - Run `npm run tauri dev` locally (or instruct the user) to ensure the app still starts.
   - Run `npm run check`, `cargo clippy`, and `cargo fmt`.
6. **Explain**
   - When done, summarize what changed, why, and any follow-up tasks or caveats.

---

## Available Tools & Commands

You can assume access (by the human developer) to:

- `gh` — GitHub operations (PRs, issues, releases).
- `wrangler` — Cloudflare Worker deployment.
- Local Rust/Node toolchain:
  - `npm install`
  - `npm run tauri dev` — run the desktop app in development.

When suggesting steps, prefer commands that fit this toolchain.

---

## Chrome DevTools MCP (Visual Debugging)

The Tauri WebView2 exposes Chrome DevTools Protocol (CDP) on **port 9222** via `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` in `src-tauri/src/lib.rs`, guarded by `#[cfg(debug_assertions)]` so it is enabled **only in debug builds**.

### Setup

1. Run `npm run tauri dev`.
2. CDP is automatically available at `http://localhost:9222`.
3. Production/release builds never expose this debug port.

### Capabilities

Use CDP-backed tools for visual debugging:

- `take_screenshot` — capture the current rendered UI.
- `evaluate_script` — run JavaScript in the webview to inspect state or trigger actions.
- `click` / `fill` / `hover` — interact with UI elements.
- `list_network_requests` / `get_network_request` — inspect ESOUI API calls.
- `list_console_messages` — read frontend logs.
- `take_snapshot` — capture the DOM accessibility tree.

### Typical Debugging Flow

1. The user starts `npm run tauri dev`.
2. Claude connects via:
   - `list_pages` -> `navigate_page` to `http://localhost:1420` -> `select_page`.
3. Use `take_screenshot` to see the current state of the app.
4. Use other CDP tools to inspect layout, state, network calls, and console messages.

Remember: CDP access must never leak into production builds.

---

## Context File Index

Before large changes, consult these:

- `context/00-overview.md` — Core vision and principles.
- `context/10-desktop-client.md` — Desktop client architecture.
- `context/20-metadata-worker.md` — Backend worker design.
- `context/30-mvp-plan.md` — Original phase roadmap.
- `context/40-design-system.md` — Design language and visual rules.
- `context/41-component-patterns.md` — Component patterns and best practices.
- `context/42-theme-tokens.md` — Theme tokens and Tailwind integration.
