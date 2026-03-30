# MVP Plan

Phase 1: Local client only

- Scaffold the Tauri app
- Detect ESO AddOns folder
- Scan installed addons
- Parse manifests
- Show addon list and dependency warnings

Phase 2: Install flow

- Accept ESOUI URL or ID
- Resolve metadata
- Download addon ZIP
- Extract into AddOns folder
- Rescan

Phase 3: Update flow

- Check updates on app open
- Add manual Refresh button
- Add Update all button
- Compare remote metadata to local addon state

Phase 4: Metadata backend

- Add Cloudflare Worker + KV
- Cache public ESOUI metadata
- Point client to backend

Phase 5: Polish

- Better dependency UX
- Error handling
- Backup and restore
- README and contributor docs
