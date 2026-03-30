# Overview

We are building Kalpa, an open-source ESO addon manager.

Core product requirements:

- Install addons directly into the ESO AddOns folder
- Resolve addon dependencies from manifest files
- Check for updates using public ESOUI pages
- Keep backend minimal, metadata-only, and low cost
- Avoid private APIs, Minion reverse engineering, or aggressive scraping

Operating principles:

- Prefer simple, explicit flows
- Refresh on app open and via a manual button
- Cache metadata centrally if a backend exists
- Keep the codebase easy to maintain and contribute to

Recommended architecture:

- Desktop client: Tauri + React + TypeScript
- Backend: Cloudflare Worker + KV
- Shared types in a small common package if needed
