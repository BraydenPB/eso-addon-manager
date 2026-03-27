# ESO Addon Manager

You are Claude Code working in this repo.

## Project Overview

An open-source ESO addon manager desktop app. Current state: **functional alpha** with addon scanning, installation, updates, dependency resolution, backups, profiles, character management, API compatibility checks, and Minion migration.

### Stack
- **Desktop client**: Tauri v2 + React 19 + TypeScript + Tailwind v4 + shadcn-ui
- **Backend** (planned): Cloudflare Workers + KV, metadata caching only
- **CI/CD**: GitHub Actions — tag-triggered release builds (Windows NSIS/MSI)

## Important Rules

- Do not use private APIs or hacks
- Prefer public ESOUI pages and direct public download URLs
- Keep scraping centralized and cached (all in `esoui.rs`)
- Do not implement hourly background scraping — use on-open refresh + manual Refresh button
- Optimize for maintainability and simplicity over cleverness

## Code Quality

- **After editing Rust code, always run both `cargo fmt` and `cargo clippy`** — clippy fixes can break formatting, so fmt must run after clippy, not before
- Frontend checks: `npm run check` (runs tsc + eslint + prettier)
- CI enforces all of these on every PR

## Architecture

```
src/                    # React frontend
  components/           # Feature components (addon-list, settings, etc.)
  components/ui/        # shadcn-ui primitives
  lib/                  # Utilities (store, utils)
  types.ts              # Shared TypeScript interfaces
src-tauri/src/          # Rust backend
  commands.rs           # All Tauri command handlers
  esoui.rs              # ESOUI HTTP client & HTML scraping
  manifest.rs           # Addon manifest (.txt) parsing
  installer.rs          # ZIP extraction & addon installation
  metadata.rs           # Metadata caching & management
  lib.rs                # Module defs & Tauri app setup
```

## Git Workflow

Use **GitHub Flow**:
1. `master` is always releasable
2. Create short-lived branches: `feat/feature-name`, `fix/bug-name`
3. Open a PR, let CI pass, merge to `master`
4. Tag releases from `master` (e.g., `v0.2.0`) — triggers release CI

### Commits
- Conventional Commits: `type(scope): description`
- Types: feat, fix, docs, style, refactor, test, chore
- Imperative mood, <50 chars, no period

### Releases
- Bump version in 3 files: `tauri.conf.json`, `Cargo.toml`, `package.json`
- Push tag `v*` to trigger `.github/workflows/release.yml`
- Release CI builds Windows NSIS/MSI installers and uploads to GitHub Releases

## Design System

The UI follows the ESO Log Aggregator visual language adapted for shadcn + Tailwind v4.
Reference files for design decisions:

1. `context/40-design-system.md` — Design principles, colors, glass morphism, typography, animations
2. `context/41-component-patterns.md` — Concrete shadcn component recipes
3. `context/42-theme-tokens.md` — CSS variables, @theme inline mappings, Tailwind utilities

### Implemented Primitives (use these, don't reinvent)
- `GlassPanel` (`ui/glass-panel.tsx`) — 3 variants: `primary`, `default`, `subtle`
- `SectionHeader` (`ui/section-header.tsx`) — uppercase micro-label (11px, Space Grotesk)
- `InfoPill` (`ui/info-pill.tsx`) — 7 colors: `gold`, `sky`, `emerald`, `amber`, `red`, `violet`, `muted`

### Overridden shadcn Components
- `Input` — glass styling (translucent bg, sky-blue focus ring)
- `Dialog` — glass morphism overlay + gradient bg + gold gradient titles
- `Toaster` — glass-styled toasts

### Key Rules
- Always-dark theme, no light mode
- Glass morphism panels (three tiers: primary, default, subtle)
- Space Grotesk (`font-heading`) for headings, Geist (`font-sans`) for body text
- 3px colored left-border on addon list items for status
- Borders: `border-white/[0.06]` not `border-border` for glass surfaces
- Dividers: `<div className="border-t border-white/[0.06]" />` not `<Separator />`
- Spinners: `border-white/[0.1] border-t-[#c4a44a]` not `border-border border-t-primary`
- Animation scale: fast (150ms), normal (250ms), slow (400ms)
- ESO gold (#c4a44a) as primary accent, sky-blue (#38bdf8) for interactive/focus

## How to Work

1. Read relevant context files before starting work
2. Read `context/40-design-system.md` before any UI work
3. Make small, reviewable changes
4. Keep the repo buildable after each change
5. Ask before making large architecture changes

## Available Tools

- `gh` for GitHub operations (PRs, issues, releases)
- `wrangler` for Cloudflare Worker deployment (when backend phase begins)
- Local Rust/Node toolchain (`npm run tauri dev` for development)

### Chrome DevTools MCP (Visual Debugging)

The Tauri WebView2 exposes Chrome DevTools Protocol on **port 9222** via `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`, set in `lib.rs` behind `#[cfg(debug_assertions)]` so it's **only enabled in debug builds**. The Chrome DevTools MCP is configured project-locally (in `~/.claude/projects/.../settings.json`) to connect via `--browserUrl http://127.0.0.1:9222`.

**Setup**: Run `npm run tauri dev` — CDP is automatically available on `localhost:9222`. Production builds are never affected.

**Capabilities**:
- `take_screenshot` — see the actual rendered UI
- `evaluate_script` — run JS in the webview (check state, trigger actions)
- `click` / `fill` / `hover` — interact with UI elements
- `list_network_requests` / `get_network_request` — inspect ESOUI API calls
- `list_console_messages` — read frontend logs
- `take_snapshot` — get full DOM accessibility tree

**Workflow for UI debugging**:
1. User starts `npm run tauri dev`
2. Claude connects via `list_pages` → `navigate_page` to `http://localhost:1420` → `select_page`
3. Use `take_screenshot` to see current state
4. Use other CDP tools to inspect, interact, and diagnose issues

**Important**: CDP is only enabled in debug builds via `#[cfg(debug_assertions)]` in `lib.rs`. Production/release builds never expose the debug port.

## Context Files

- `context/00-overview.md` — Core vision and principles
- `context/10-desktop-client.md` — Desktop client architecture
- `context/20-metadata-worker.md` — Backend worker design
- `context/30-mvp-plan.md` — Original phase roadmap (phases 1-3 complete)
