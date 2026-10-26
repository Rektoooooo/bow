/**
 * WHY this file exists:
 *   Gives statusBubble.ts one function to set the bubble's text. Text only (textContent), never HTML.
 *
 * Data source:
 *   statusBubble.ts calls window.showStatus(text) with executeJavaScript.
 */
declare global {
  interface Window {
    showStatus: (text: string) => void;
  }
}

window.showStatus = (text: string): void => {
  const status = document.getElementById("status");
  if (status !== null) {
    status.textContent = text;
  }
};

export {};
