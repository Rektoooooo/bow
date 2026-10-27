/**
 * WHY this file exists:
 *   Gives statusBubble.ts the functions that set what the view shows: a link's address (bottom-left pill) or a
 *   confirmation (a centered toast that fades in and out). Text only (textContent), never HTML.
 *
 * Data source:
 *   statusBubble.ts calls window.showStatus(text), window.showToast(text) and window.fadeToast() with
 *   executeJavaScript.
 */
declare global {
  interface Window {
    showStatus: (text: string) => void;
    showToast: (text: string) => void;
    fadeToast: () => void;
  }
}

window.showStatus = (text: string): void => {
  const status = document.getElementById("status");
  if (status !== null) {
    document.body.classList.remove("is-toast", "is-fading");
    status.textContent = text;
  }
};

window.showToast = (text: string): void => {
  const status = document.getElementById("status");
  if (status === null) {
    return;
  }
  status.textContent = `✓  ${text}`;
  document.body.classList.remove("is-fading");
  // Restarts the entrance animation when a second confirmation follows the first.
  document.body.classList.remove("is-toast");
  void document.body.offsetWidth;
  document.body.classList.add("is-toast");
};

window.fadeToast = (): void => {
  document.body.classList.add("is-fading");
};

export {};
