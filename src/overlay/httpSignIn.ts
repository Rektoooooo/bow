/**
 * WHY this file exists:
 *   The card for a site (or proxy) that asks for a username and password before it shows a page: "Sign in to
 *   example.com", the realm the server named, Username and Password fields, and Cancel / Sign In. When Bow
 *   Passwords has a login for the site, a button uses it. The card never gets a saved password, only the username
 *   to show on the button; main reads the password itself when the button is pressed.
 *
 * Data source:
 *   The "httpSignIn" panel from httpSignIn.ts (host, realm, whether it is a proxy, the saved username, whether
 *   saving is offered, the request id).
 *
 * Data flow:
 *   "overlay:show" (httpSignIn) → renderHttpSignIn() → Sign In / Use saved login / Cancel → dispatch answerHttpSignIn.
 *   Escape or a click outside closes the card: main treats that as Cancel.
 */
import type { OverlayPanel } from "../shared/overlay";
import { createElement, createTextButton, dispatch } from "../renderer/dom.js";

/** Builds a labelled text field; the label is the placeholder, with an accessible name too. */
function createField(label: string, type: "text" | "password"): HTMLInputElement {
  const field = document.createElement("input");
  field.type = type;
  field.className = "http-sign-in-field";
  field.placeholder = label;
  field.setAttribute("aria-label", label);
  field.autocomplete = "off";
  field.spellcheck = false;
  return field;
}

/**
 * Builds the card.
 */
export function renderHttpSignIn(host: HTMLElement, panel: Extract<OverlayPanel, { kind: "httpSignIn" }>): void {
  const card = createElement("div", "panel permission-prompt http-sign-in");
  card.setAttribute("role", "alertdialog");
  card.setAttribute("aria-label", "Sign in");

  const title = createElement("p", "permission-title");
  if (panel.isProxy) {
    title.append("The proxy ", createElement("strong", "permission-host", panel.host), " asks you to sign in");
  } else {
    title.append("Sign in to ", createElement("strong", "permission-host", panel.host));
  }
  // The realm is the server's own words: only ever put in as text.
  const realmLine = createElement("p", "http-sign-in-realm", panel.realm === "" ? "No description from the site" : panel.realm);
  realmLine.title = panel.realm;

  const fields = createElement("div", "http-sign-in-fields");
  const usernameField = createField("Username", "text");
  const passwordField = createField("Password", "password");
  fields.append(usernameField, passwordField);

  const saveBox = document.createElement("input");
  saveBox.type = "checkbox";
  saveBox.checked = true;
  const saveLabel = createElement("label", "http-sign-in-save");
  saveLabel.append(saveBox, "Save in Bow Passwords");

  const answer = (choice: "signIn" | "useSaved" | "cancel"): void => {
    const isTyped = choice === "signIn";
    dispatch({
      type: "answerHttpSignIn",
      requestId: panel.requestId,
      choice: choice,
      username: isTyped ? usernameField.value : "",
      password: isTyped ? passwordField.value : "",
      shouldSave: isTyped && panel.canSave && saveBox.checked,
    });
  };
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      answer("signIn");
    }
  });

  const buttons = createElement("div", "permission-buttons");
  buttons.append(
    createTextButton("Cancel", "permission-button", () => answer("cancel")),
    createTextButton("Sign In", "permission-button is-primary", () => answer("signIn")),
  );

  const text = createElement("div", "permission-text");
  text.append(title, realmLine);
  if (panel.savedUsername !== null) {
    text.append(createTextButton(`Use saved login (${panel.savedUsername})`, "permission-button http-sign-in-saved", () => answer("useSaved")));
  }
  text.append(fields);
  if (panel.canSave) {
    text.append(saveLabel);
  }
  card.append(text, buttons);
  host.replaceChildren(card);
  requestAnimationFrame(() => usernameField.focus());
}
