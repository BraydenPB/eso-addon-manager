# Contributing

Thanks for your interest in contributing to ESO Addon Manager!

## Getting Started

1. Fork the repository
2. Clone your fork and install dependencies:

```bash
git clone https://github.com/YOUR_USERNAME/eso-addon-manager.git
cd eso-addon-manager
npm install
```

3. Start the development server:

```bash
npm run tauri dev
```

## Prerequisites

- [Rust](https://rustup.rs/) (stable, MSVC toolchain on Windows)
- [Node.js](https://nodejs.org/) 18+
- On Windows: Visual Studio Build Tools with "Desktop development with C++"

## Development Workflow

1. Create a branch from `master`: `git checkout -b feat/your-feature` or `fix/your-bug`
2. Make your changes
3. Run checks before committing:

```bash
# Frontend
npm run check        # tsc + eslint + prettier

# Backend
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
```

4. Commit using [Conventional Commits](https://www.conventionalcommits.org/):
   - `feat: add new feature`
   - `fix: resolve bug`
   - `refactor: restructure code`
   - `docs: update documentation`
5. Open a pull request against `master`

## Code Style

- **TypeScript**: Strict mode, no `any` types, Prettier formatting
- **Rust**: `cargo fmt` + `cargo clippy` with `-D warnings`
- **CSS**: Tailwind v4 utility classes, follow the design system in `context/40-design-system.md`

## Architecture

See the project structure in the README and detailed docs in the `context/` directory:

- `context/00-overview.md` — Core vision and principles
- `context/10-desktop-client.md` — Desktop client architecture
- `context/40-design-system.md` — Design system and styling rules

## Reporting Issues

- Use [GitHub Issues](https://github.com/BraydenPB/eso-addon-manager/issues)
- Include steps to reproduce, expected vs actual behavior
- For security vulnerabilities, see [SECURITY.md](SECURITY.md)
