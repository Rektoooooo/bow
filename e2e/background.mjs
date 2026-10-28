// WHY this file exists:
//   The e2e checks start the real app many times for many minutes. Imported first by each check, this makes the app
//   run in the background (src/main/backgroundTesting.ts): no Dock icon, invisible windows that never take the
//   focus and let clicks pass, so the Mac stays usable meanwhile. BOW_E2E_FOREGROUND=1 shows the windows instead,
//   to watch a check.
// Data flow: process.env.BOW_E2E_BACKGROUND → Playwright passes the environment to the app it starts.
if (process.env.BOW_E2E_FOREGROUND !== "1") {
  process.env.BOW_E2E_BACKGROUND = "1";
}
