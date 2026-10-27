# Contributing to Bow

Thanks for wanting to help. Bow is a small project with a few firm rules; reading this page first saves a round of
review.

## Before you start

- **Bugs and ideas** go in [Issues](https://github.com/Rektoooooo/bow/issues). For a bigger change, open an issue
  first so we can agree on the shape before you write it.
- **Security problems** do not go in public issues: see [SECURITY.md](SECURITY.md).
- Bow runs on macOS for now (Apple silicon is what we test on).

## Set up

```bash
nvm use        # Node 24 (see .nvmrc)
npm install
npm start      # builds, then opens Bow with your normal profile
npm test       # unit tests (Vitest), a few seconds
npm run e2e    # drives the real app with Playwright: opens windows for a few minutes, throwaway profiles
```

`npm run e2e` never touches your real data: every check runs with its own `--user-data-dir` under `e2e/output/`.

## How the code works

[CLAUDE.md](CLAUDE.md) is the architecture guide (it is written for AI coding agents and for people alike). The short
version:

- **Pure core.** The state rules (`state.ts`, `spaces.ts`, `split.ts`, `tree.ts`, `windows.ts`, `autoArchive.ts`,
  `commandBar.ts`, …) take data in and return a changed copy. No Electron and no clock inside; `now` is a parameter.
- **One way to change state.** Only `applyChange()` in `src/main/browserCore.ts` replaces the state.
- **Actions.** Our pages send one `BrowserAction`; `ipc.ts` checks every field before `actionRunner.ts` runs it.
- **Render from state.** The sidebar redraws from the newest state; web views are reconciled by `syncTabViews()`.
- A change to the saved shape needs a version bump and an upgrade step in `migrate.ts`.

## Code style

Every line should be easy to explain to a reviewer:

- Full, descriptive names; no single letters or abbreviations.
- At most two levels of nesting; return early instead.
- No clever one-liners; name intermediate values.
- No helper or abstraction before the third repetition.
- Comments say *why*, not *what*. Each file starts with a short header: why it exists, where its data comes from,
  and how data flows through it.
- No magic numbers: name them in `src/shared/settings.ts` (or at the top of the file) with where the value comes
  from.

## Tests

- A change to a state rule comes with a unit test in `tests/`.
- A change to what you see or click is checked by the matching end-to-end script in `e2e/` (`check-app.mjs`,
  `check-overlay.mjs`, `check-windows.mjs`, …). Run that one while you work and `npm run e2e` before you open the
  pull request.
- `e2e/permission-check.mjs` proves that web pages get no more than they were allowed. It must keep passing.

## About Arc

Bow rebuilds how Arc *behaves*. Studying Arc to understand its behavior is fine; copying it is not. Never add Arc's
code, icons, images, Lottie files, sounds, videos, shaders or rule lists (tidy titles, ad-block or keepalive lists),
and never use Arc's name or logo for Bow. Test extensions are synthetic (`e2e/fixtures/`), never copied from a real
profile, and nothing personal (your bookmarks, history or screenshots of your own browser) goes into the repository.

## Pull requests

- Keep each pull request to one change, with a title that says what the user gets.
- Say how you tested it, and add a screenshot for anything visual.
- By contributing you agree that your work is released under the [MIT License](LICENSE) and that you follow the
  [Code of Conduct](CODE_OF_CONDUCT.md).
