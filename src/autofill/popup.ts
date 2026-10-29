/**
 * WHY this file exists:
 *   Draws the list under a form field: a key icon, the username and dots for a saved login, one line for a remembered
 *   value. It never sees a password (main sends titles only). A press on a row (pointer down, so it beats the web
 *   page's blur) tells main which row; main fills the field.
 *
 * Data source:
 *   The message autofillPopup.ts sends through window.autofillApi (rows, the highlighted row, dark or light, above or
 *   below the field). Text is set with textContent only.
 *
 * Data flow:
 *   "autofill:show" → renderList() → #autofill-list rows
 *   pointer down on a row → autofillApi.choose(index) → main fills the field
 */
import type { AutofillItem, AutofillShowMessage } from "../shared/autofill";
import type { SymbolImage } from "../shared/symbols";
import { createIcon, installSymbols } from "../renderer/icons.js";

/** The bridge autofillPopupPreload.ts provides. */
interface AutofillApi {
  onShow(listener: (message: AutofillShowMessage) => void): void;
  choose(index: number): Promise<void>;
  getSymbols(): Promise<Record<string, SymbolImage>>;
}

declare global {
  interface Window {
    autofillApi: AutofillApi;
  }
}

/** Shown under a login's username instead of its password (the page never has the password). */
const HIDDEN_PASSWORD_DOTS = "••••••••";

function buildRow(item: AutofillItem, index: number): HTMLElement {
  const row = document.createElement("div");
  row.className = item.kind === "login" ? "autofill-row is-login" : "autofill-row is-value";
  row.setAttribute("role", "option");
  row.dataset.index = String(index);
  const title = document.createElement("span");
  title.className = "autofill-title";
  title.textContent = item.title;
  if (item.kind === "value") {
    row.append(title);
    return row;
  }
  const dots = document.createElement("span");
  dots.className = "autofill-dots";
  dots.textContent = HIDDEN_PASSWORD_DOTS;
  const text = document.createElement("span");
  text.className = "autofill-text";
  text.append(title, dots);
  row.append(createIcon("key", "icon autofill-icon"), text);
  return row;
}

function renderList(list: HTMLElement, message: AutofillShowMessage): void {
  document.documentElement.classList.toggle("is-dark", message.isDark);
  document.documentElement.classList.toggle("is-light", !message.isDark);
  document.body.classList.toggle("is-above", message.isAbove);
  const rows = message.items.map((item, index) => buildRow(item, index));
  rows.forEach((row, index) => row.classList.toggle("is-highlighted", index === message.highlightedIndex));
  list.replaceChildren(...rows);
}

/**
 * Pointer down, not click: a click would come after the web page lost the focus and the list closed.
 */
function chooseRowUnderPointer(event: PointerEvent): void {
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }
  const row = target.closest(".autofill-row");
  if (!(row instanceof HTMLElement)) {
    return;
  }
  event.preventDefault();
  const index = Number(row.dataset.index);
  window.autofillApi.choose(index).catch(() => undefined);
}

function start(): void {
  const list = document.getElementById("autofill-list");
  if (list === null) {
    return;
  }
  window.autofillApi.getSymbols().then(installSymbols).catch(() => undefined);
  list.addEventListener("pointerdown", chooseRowUnderPointer);
  window.autofillApi.onShow((message) => renderList(list, message));
}

start();
