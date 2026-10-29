// WHY this file exists:
//   The e2e checks start the real app many times for many minutes. Imported first by each check, this makes the app
//   run in the background (src/main/backgroundTesting.ts): no Dock icon, invisible windows that never take the
//   focus and let clicks pass, so the Mac stays usable meanwhile. BOW_E2E_FOREGROUND=1 shows the windows instead,
//   to watch a check.
//   BOW_E2E_MOCK_KEYCHAIN=1 is set always (also in foreground runs): the saved-passwords vault then uses a test key
//   instead of the real Keychain, so a run never shows a Keychain dialog or creates a Keychain item.
// Data flow: process.env.BOW_E2E_BACKGROUND, BOW_E2E_MOCK_KEYCHAIN → Playwright passes the environment to the app it starts.
if (process.env.BOW_E2E_FOREGROUND !== "1") {
  process.env.BOW_E2E_BACKGROUND = "1";
}
process.env.BOW_E2E_MOCK_KEYCHAIN = "1";
