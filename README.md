# ESO Addon Manager

[![CI](https://github.com/BraydenPB/eso-addon-manager/actions/workflows/ci.yml/badge.svg)](https://github.com/BraydenPB/eso-addon-manager/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A fast, open-source addon manager for The Elder Scrolls Online. Built with Tauri, React, and Rust.

## Features

- **Scan installed addons** — automatically detects your ESO AddOns folder and parses every addon manifest
- **Dependency checking** — shows missing required dependencies with support for embedded/bundled libraries
- **Install from ESOUI** — paste an ESOUI URL or addon ID, or browse categories to discover and install addons
- **Auto-install dependencies** — searches ESOUI for missing dependencies and installs them automatically
- **Update checking** — checks ESOUI for newer versions of your tracked addons on startup and refresh
- **One-click updates** — update individual addons or all at once
- **Remove addons** — safely remove addons with dependency warnings
- **Profiles** — save and switch between different addon configurations
- **Backups** — backup and restore SavedVariables data
- **Search and filter** — find addons quickly by name, folder, or author
- **Character management** — view and backup per-character settings
- **Minion migration** — import your existing Minion addon tracking data
- **Dark theme** — ESO-inspired glass morphism UI with gold accents

## Install

### Pre-built

Download the latest installer from the [Releases](https://github.com/BraydenPB/eso-addon-manager/releases) page.

### Build from source

**Prerequisites:**
- [Rust](https://rustup.rs/) (stable, MSVC toolchain on Windows)
- [Node.js](https://nodejs.org/) 18+
- On Windows: Visual Studio Build Tools with "Desktop development with C++"

```bash
# Clone the repo
git clone https://github.com/BraydenPB/eso-addon-manager.git
cd eso-addon-manager

# Install frontend dependencies
npm install

# Run in development mode
npm run tauri dev

# Build for production
npm run tauri build
```

The production build outputs an installer to `src-tauri/target/release/bundle/`.

## How it works

- **Manifest parsing** — reads `.txt` and `.addon` manifest files from each addon folder, extracting title, version, author, dependencies, and more
- **Dependency resolution** — scans the full AddOns directory tree (up to 3 levels deep) to find installed libraries, including those embedded inside other addons
- **ESOUI integration** — scrapes public ESOUI pages to resolve addon metadata and download links (no private APIs)
- **Metadata tracking** — stores ESOUI IDs and installed versions in `eso-addon-manager.json` inside your AddOns folder to enable update checking

## Tech stack

- **Desktop app**: [Tauri v2](https://v2.tauri.app/) (Rust backend + webview)
- **Frontend**: React 19 + TypeScript + Vite
- **Styling**: Tailwind CSS v4 + shadcn/ui
- **HTTP**: reqwest
- **HTML parsing**: scraper
- **ZIP handling**: zip crate

## Project structure

```
src/                    # React frontend
  App.tsx               # Main app shell
  components/           # Feature + UI components
  types.ts              # Shared TypeScript types
  lib/                  # Utilities and store
src-tauri/              # Rust backend
  src/
    commands.rs         # Tauri command handlers
    manifest.rs         # ESO manifest parser
    esoui.rs            # ESOUI scraping and downloads
    installer.rs        # ZIP extraction and addon removal
    metadata.rs         # Install tracking (JSON persistence)
context/                # Design and architecture documents
```

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

Please open an issue first to discuss what you'd like to change.

## Security

To report a vulnerability, see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
