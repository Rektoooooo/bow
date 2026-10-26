# Reverse-engineering setup

How the tools for studying Arc were installed on this Mac, what broke, and how to pick the work up again.
The tool is [REA](https://github.com/morluto/rea) (`rea-agents` on npm), driven by Claude Code over MCP.

## What is installed (all in the home folder)

| Tool | Version | Where | Why there |
|---|---|---|---|
| Node.js | 24.22.1 (darwin-arm64, SHA-256 checked) | `~/.local/share/node/node-v24.22.1-darwin-arm64`, symlinked into `~/.local/bin` (`node`, `npm`, `npx`, `corepack`) | REA needs Node 22.23.4+, 24.22.1+ or 26.12.1+. The Homebrew Node was 23.10 (unsupported), and Homebrew on this Mac belongs to another macOS account, so `brew install` fails with permission errors. `~/.local/bin` comes before `/opt/homebrew/bin` on PATH. Undo by removing the four symlinks. |
| REA | 6.8.0 | MCP server `rea` in `~/.claude.json` (user scope): `npx -y rea-agents@6.8.0 mcp`; skill at `~/.claude/skills/reverse-engineer-anything` | Installed with `npx -y rea-agents@latest setup --client claude_code --yes`. Backups: `~/.claude.json.rea.backup`, `~/.claude.json.pre-ghidra.backup`. |
| JDK | Temurin 21.0.13+9, aarch64 (SHA-256 checked) | `~/.local/share/jdk/jdk-21.0.13+9/Contents/Home` | Ghidra 12.1 needs JDK 21+. Not on PATH (Homebrew `openjdk@17` is first on PATH), so `JAVA_HOME` must be set. |
| Ghidra | 12.1.4 (SHA-256 checked) | `~/.local/share/ghidra/ghidra_12.1.4_PUBLIC` | REA accepts Ghidra 12.1.x only; 12.2 was out but unsupported. |

The REA MCP entry carries these environment variables, so Claude Code sessions get Ghidra automatically:

```json
"env": {
  "GHIDRA_INSTALL_DIR": "~/.local/share/ghidra/ghidra_12.1.4_PUBLIC (absolute path in the file)",
  "JAVA_HOME": "~/.local/share/jdk/jdk-21.0.13+9/Contents/Home (absolute path in the file)",
  "REA_GHIDRA_STARTUP_TIMEOUT_MS": "1800000"
}
```

Check health any time:

```bash
GHIDRA_INSTALL_DIR="$HOME/.local/share/ghidra/ghidra_12.1.4_PUBLIC" JAVA_HOME="$HOME/.local/share/jdk/jdk-21.0.13+9/Contents/Home" npx -y rea-agents@6.8.0 doctor --json
```

All `ghidra-*` checks were healthy. "healthy: false" overall only reflects engines not installed (Hopper, IDA, JADX, Kuna)
and agents not configured.

## The Apple Silicon decompiler had to be built

The official Ghidra 12.1.4 download ships the native decompiler only for Linux and Windows. Built from Ghidra's
bundled source with REA's documented recipe (Xcode CLT, `make`, stock `bison` 2.3; took about 3 minutes):

```bash
cd "$GHIDRA_INSTALL_DIR/Ghidra/Features/Decompiler/src/decompile/cpp"
make -j8 ghidra_opt ARCH_TYPE="-arch arm64" OSDIR=mac_arm_64
mkdir -p "$GHIDRA_INSTALL_DIR/Ghidra/Features/Decompiler/os/mac_arm_64"
install -m 755 ghidra_opt "$GHIDRA_INSTALL_DIR/Ghidra/Features/Decompiler/os/mac_arm_64/decompile"
```

Verified: decompiling a function from Arc's Dock plugin returned Swift pseudocode with readable names.

## Gotchas found the hard way

1. **Universal binaries are refused.** Ghidra through REA reports `architecture_unsupported` for a universal (fat)
   Mach-O. Analyze a thin copy:
   `lipo -thin arm64 /Applications/Arc.app/Contents/MacOS/Arc -output Arc-arm64`
2. **REA's CLI re-imports on every command.** Each `rea decompile …` starts a fresh Ghidra import; for Arc's 76 MB
   slice that is far too slow. Use the MCP server, which keeps one Ghidra session open. Inside Claude Code that means
   the `mcp__rea__*` tools (available after a restart). Outside it, use [`tools/rea-driver`](../../tools/rea-driver).
3. **Memory.** This Mac has 16 GB of RAM and usually two macOS accounts logged in. On 2026-10-26 swap was at
   27.4 of 28.7 GB, and the Ghidra import of Arc (`GHIDRA_HEADLESS_MAXMEM=8G`) sat at about 2% CPU for 10 minutes,
   thrashing. It was stopped. Before a big import, check `sysctl vm.swapusage` and `who`; log the other account
   out and quit large apps first.
4. **Screen recording is not allowed** for the shell, so `screencapture -l` fails. The e2e scripts composite
   window captures instead.

## Static tricks that work without Ghidra

- `strings -a Arc-arm64 | grep -i archiv` found the source paths, threshold labels and log strings.
- Swift field and enum-case names sit next to each other in `__swift5_reflstr`. `tools/swift-reflstr.py` prints the
  neighbours of every match, which reads like a type's field list:

  ```bash
  python3 -I tools/swift-reflstr.py Arc-arm64 '(?i)autoArchive|itemLastActive|keepalive'
  ```

- REA without an engine: `npx -y rea-agents@6.8.0 inspect-desktop-application /Applications/Arc.app --format json`
  (scanned 1,955 entries).

## Rerunning the Ghidra pass

In a Claude Code session (REA tools load automatically):

1. Check memory first (`sysctl vm.swapusage`). Free RAM if swap is nearly full.
2. Thin the binary with `lipo` (above).
3. `open_binary` with the thin path and `provider_id: "ghidra"`, then `search_strings` for `Auto archived`, then
   `xrefs` on the hits, `resolve_containing_procedure`, and `procedure_pseudo_code`.
4. Answer the five open questions in [arc-findings.md](arc-findings.md#unknown-needs-ghidra), then update that file
   and the auto-archive section of `docs/arc-teardown.html`.

Outside Claude Code, the same calls go through the driver:

```bash
export GHIDRA_INSTALL_DIR="$HOME/.local/share/ghidra/ghidra_12.1.4_PUBLIC"
export JAVA_HOME="$HOME/.local/share/jdk/jdk-21.0.13+9/Contents/Home"
export REA_GHIDRA_STARTUP_TIMEOUT_MS=5400000 GHIDRA_HEADLESS_MAXMEM=8G
export REA_SESSION_DIR="$TMPDIR/rea-session"
node tools/rea-driver/rea-driver.mjs "$REA_SESSION_DIR" &      # keeps REA + Ghidra alive
tools/rea-driver/rea-call.sh 001 open_binary '{"path":"/absolute/path/Arc-arm64","provider_id":"ghidra"}'
tools/rea-driver/rea-call.sh 002 search_strings '{"pattern":"Auto archived"}' 600
touch "$REA_SESSION_DIR/req/STOP"                               # shuts it down
```
