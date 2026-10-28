# Bow for Raycast

Three Raycast script commands that drive Bow through its `bow://` addresses. They are plain shell scripts with no
dependencies: they only call `open "bow://…"`.

| Command | What it does | Address |
| --- | --- | --- |
| Open in Bow | Opens an address or a search, in a Space if you name one | `bow://open?url=github.com&space=Work` |
| Switch Bow Space | Switches to a Space by its name (or the start of it) or its number | `bow://space?name=Work` |
| Search Bow Tabs | Brings Bow forward with tab search (⇧⌘A) and your words typed in | `bow://search-tabs?q=docs` |

## Setup

1. In Raycast, open Settings › Extensions, click **+** and choose **Add Script Directory**.
2. Choose this folder (`integrations/raycast`).
3. Type "Open in Bow", "Switch Bow Space" or "Search Bow Tabs" in Raycast.

The packaged Bow (`npm run package`, or a release) registers `bow://` with macOS; a development run (`npm start`) does
not.

## Other apps

Anything that opens a URL can use the same addresses: Alfred, Shortcuts (Open URLs), or the Terminal:

```bash
open "bow://command-bar?q=weather"
```

| Address | What it does |
| --- | --- |
| `bow://open?url=<address or words>&space=<name or number>` | Opens an address, or searches the words, in a new tab |
| `bow://space?name=<name or number>` | Switches Spaces |
| `bow://search-tabs?q=<words>` | Tab search with the words typed in |
| `bow://command-bar?q=<text>` | The Command Bar with the text typed in |
| `bow://little?url=<address>` | A Little Window (with the address, if given) |

None of them closes, deletes or reads anything. A link to a `bow://` address on a web page asks first, like any link
to an app.
