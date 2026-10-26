# Arc rebuild

- [x] Map Arc's bundle, features and architecture (arc-teardown.html)
- [x] Choose a build path: Electron + TypeScript
- [x] Install Node 24 LTS and run REA setup (Node 24.22.1 in ~/.local; REA 6.8.0 registered; restart pending)
- [x] Set up a decompiler: Ghidra 12.1.4 + JDK 21 in ~/.local/share, connected to REA, test decompile OK
- [ ] Back up and inspect StorableSidebar.json on the account that uses Arc
- [~] Auto-archive: design mapped from metadata; Ghidra pass blocked on free RAM (intervals, exclusions, retention open)
- [ ] Trace remaining Binary features: Command Bar ranking, Peek triggers, sync merge, Easel captures, BlockListClient
- [x] Build milestone 1 (sidebar, Spaces, auto-archive): done, 20 unit tests + 23 end-to-end checks passing
- [ ] Then: Command Bar, Peek, Little Arc, split view

## Review
- Feature map published: https://claude.ai/code/artifact/e8ba659b-13e9-4f46-b52a-d157ccb8a345
