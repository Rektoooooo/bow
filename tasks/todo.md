# Sidebar Browser — to-do

## Done

- [x] Map Arc's bundle, features and architecture (`docs/arc-teardown.html`, `docs/research/arc-findings.md`)
- [x] Choose a build path: Electron + TypeScript
- [x] Node 24 + REA 6.8.0 installed and registered with Claude Code
- [x] Ghidra 12.1.4 + JDK 21 installed, Apple Silicon decompiler built, connected to REA, test decompile OK
- [x] Auto-archive design mapped from Arc's Swift metadata (5 questions still open, need Ghidra)
- [x] Milestone 1: sidebar, Spaces, pinned/today tabs, inset card, Archive, auto-archive, saving, permission lockdown
- [x] Tests: 20 unit, 23 end-to-end + permission check
- [x] Public repo: https://github.com/Rektoooooo/sidebar-browser

## Next

- [ ] Milestone 2: keyboard shortcuts and app menu (menu accelerators in the main process)
- [ ] Favicons, back/forward/reload, open links in a new tab
- [ ] Create / rename / recolor Spaces; drag-and-drop ordering; folders in Pinned
- [ ] Command Bar, Peek, Little Arc, Split View
- [ ] Ghidra pass on auto-archive when RAM allows (timers, exclusions, refreshed tabs, retention, default)
- [ ] Trace remaining Binary features: Command Bar ranking, Peek triggers, sync merge, Easel captures, BlockListClient
- [ ] Back up `StorableSidebar.json` from the macOS account that uses Arc
