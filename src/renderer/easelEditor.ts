/**
 * WHY this file exists:
 *   Arc's Easels: a board you fill with text, drawings, pictures and captures of pages. When an easel tab is selected
 *   this editor fills the page card. Two fingers move the board, pinching (or ⌘ and the wheel) zooms; the tools are
 *   Select (move, resize, Delete), Text, Pen (five colors), Picture (pick a file, paste or drop one) and Capture
 *   (a screenshot or capture from the Library). A capture of a web page is live, like Arc's: it is taken again when
 *   the board opens (if it is older than LIVE_CAPTURE_STALE_MS) or when its "Live" badge is clicked. Changes are saved
 *   a moment after they happen.
 *
 * Data source:
 *   The board's JSON (browserApi.readEasel), the Library's captures (browserApi.listCaptures / readCapture), live
 *   captures taken again (browserApi.retakeCapture).
 *
 * Data flow:
 *   sidebar.ts (an easel tab is selected) → showEaselEditor(easelId) → readEasel → board drawn in a moving "world"
 *   pointer and keys → board changes → drawn again → a moment later → browserApi.saveEasel(easelId, json)
 */
import { createEmptyBoard } from "../shared/easels.js";
import type { CaptureSource, EaselBoard, EaselElement, EaselImage, EaselStroke, EaselText } from "../shared/easels.js";
import { createElement } from "./dom.js";
import { createIcon } from "./icons.js";

type Tool = "select" | "text" | "pen";

/** Save this long after the last change. Our choice. */
const SAVE_DELAY_MS = 800;

/** The pen's colors and the text's (our choice). "ink" is the text color of the board, so it reads in light and dark. */
const PEN_COLORS = ["ink", "#e5484d", "#f5a524", "#30a46c", "#3e63dd"];

/**
 * A saved color as CSS ("ink" follows the light or dark board).
 */
function toCssColor(color: string): string {
  return color === "ink" ? "var(--note-ink)" : color;
}

/** Pen width and text size on the board, in board points. Our choice. */
const PEN_WIDTH = 3;
const TEXT_SIZE = 18;
const TEXT_WIDTH = 260;

/** A dropped or pasted picture is placed at most this wide, in board points. Our choice. */
const MAX_PICTURE_WIDTH = 520;

/** Zoom limits and how strongly a pinch zooms. Our choice. */
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 4;
const PINCH_ZOOM_SPEED = 0.01;

/** Pen points closer than this (in screen pixels) are skipped, which keeps strokes small and smooth. */
const MIN_POINT_DISTANCE_PX = 2;

/** A live capture older than this is taken again when its board opens. Our choice: fresh, without a reload per glance. */
const LIVE_CAPTURE_STALE_MS = 5 * 60 * 1000;

/** One open board and everything the editor needs about it. */
interface OpenBoard {
  easelId: string;
  board: EaselBoard;
  tool: Tool;
  color: string;
  selectedId: string | null;
  world: HTMLElement;
  strokes: SVGSVGElement;
  viewport: HTMLElement;
  zoomLabel: HTMLElement;
  /** Live captures being taken again right now: their badge says so. */
  refreshingIds: Set<string>;
}

let openBoard: OpenBoard | null = null;
let saveTimer: number | null = null;
let elementCounter = 0;

/**
 * A new element id, unique within the board.
 */
function createElementId(prefix: string): string {
  elementCounter = elementCounter + 1;
  return `${prefix}-${Date.now()}-${elementCounter}`;
}

/**
 * Saves the board a moment after the last change.
 */
function scheduleSave(current: OpenBoard): void {
  if (saveTimer !== null) {
    window.clearTimeout(saveTimer);
  }
  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    window.browserApi.saveEasel(current.easelId, JSON.stringify(current.board)).catch(() => undefined);
  }, SAVE_DELAY_MS);
}

/**
 * Where a point on screen falls on the board.
 */
function toBoardPoint(current: OpenBoard, clientX: number, clientY: number): [number, number] {
  const box = current.viewport.getBoundingClientRect();
  const view = current.board.view;
  return [(clientX - box.left - view.x) / view.zoom, (clientY - box.top - view.y) / view.zoom];
}

/**
 * Moves and scales the world to the board's view.
 */
function applyView(current: OpenBoard): void {
  const view = current.board.view;
  current.world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`;
  current.zoomLabel.textContent = `${Math.round(view.zoom * 100)}%`;
}

/**
 * An SVG path for a stroke: smooth curves through the midpoints of its points.
 */
function buildStrokePath(points: [number, number][]): string {
  const first = points[0];
  if (first === undefined) {
    return "";
  }
  let path = `M ${first[0]} ${first[1]}`;
  for (let index = 1; index < points.length - 1; index++) {
    const point = points[index] as [number, number];
    const next = points[index + 1] as [number, number];
    path += ` Q ${point[0]} ${point[1]} ${(point[0] + next[0]) / 2} ${(point[1] + next[1]) / 2}`;
  }
  const last = points[points.length - 1] as [number, number];
  return `${path} L ${last[0]} ${last[1]}`;
}

/**
 * Draws one stroke.
 */
function drawStroke(current: OpenBoard, stroke: EaselStroke): void {
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", buildStrokePath(stroke.points));
  path.style.stroke = toCssColor(stroke.color);
  path.setAttribute("stroke-width", String(stroke.width));
  path.dataset.id = stroke.id;
  path.classList.toggle("is-selected", stroke.id === current.selectedId);
  current.strokes.append(path);
}

/**
 * Draws a text box (editable in place).
 */
function drawText(current: OpenBoard, text: EaselText): void {
  const box = createElement("div", "easel-item easel-text");
  box.dataset.id = text.id;
  box.contentEditable = "true";
  box.spellcheck = false;
  box.textContent = text.text;
  box.style.left = `${text.x}px`;
  box.style.top = `${text.y}px`;
  box.style.width = `${text.width}px`;
  box.style.fontSize = `${text.size}px`;
  box.style.color = toCssColor(text.color);
  box.classList.toggle("is-selected", text.id === current.selectedId);
  box.addEventListener("input", () => {
    text.text = box.innerText;
    scheduleSave(current);
  });
  box.addEventListener("paste", (event) => {
    event.preventDefault();
    document.execCommand("insertText", false, event.clipboardData?.getData("text/plain") ?? "");
  });
  current.world.append(box);
}

/**
 * Draws a picture with a corner to resize it.
 */
function drawImage(current: OpenBoard, image: EaselImage): void {
  const frame = createElement("div", "easel-item easel-image");
  frame.dataset.id = image.id;
  frame.style.left = `${image.x}px`;
  frame.style.top = `${image.y}px`;
  frame.style.width = `${image.width}px`;
  frame.style.height = `${image.height}px`;
  frame.classList.toggle("is-selected", image.id === current.selectedId);
  const picture = document.createElement("img");
  picture.src = image.src;
  picture.alt = "";
  picture.draggable = false;
  const handle = createElement("span", "easel-resize");
  handle.dataset.resize = image.id;
  frame.append(picture, handle);
  if (image.sourceUrl !== null) {
    frame.title = image.sourceUrl;
  }
  if (image.live !== undefined) {
    frame.append(createLiveBadge(current, image));
  }
  current.world.append(frame);
}

/**
 * A live capture's badge: "Live", or "Updating…" while it is taken again. A click takes it again now.
 */
function createLiveBadge(current: OpenBoard, image: EaselImage): HTMLElement {
  const isRefreshing = current.refreshingIds.has(image.id);
  const badge = createElement("button", "easel-live", isRefreshing ? "Updating…" : "Live");
  badge.classList.toggle("is-updating", isRefreshing);
  badge.title = isRefreshing ? "Taking this capture again" : "A live capture: click to take it again now";
  badge.dataset.liveId = image.id;
  // The badge sits on the picture: pressing it must not start moving the picture.
  badge.addEventListener("pointerdown", (event) => event.stopPropagation());
  badge.addEventListener("click", (event) => {
    event.stopPropagation();
    refreshLiveCapture(current, image.id).catch(() => undefined);
  });
  return badge;
}

/**
 * Takes a live capture again and puts the new picture in its place (same box on the board).
 */
async function refreshLiveCapture(current: OpenBoard, imageId: string): Promise<void> {
  const image = current.board.elements.find((element): element is EaselImage => element.kind === "image" && element.id === imageId);
  if (image === undefined || image.live === undefined || current.refreshingIds.has(imageId)) {
    return;
  }
  current.refreshingIds.add(imageId);
  drawBoard(current);
  const src = await window.browserApi.retakeCapture(image.live.source).catch(() => null);
  current.refreshingIds.delete(imageId);
  if (src !== null) {
    image.src = src;
    image.live = { source: image.live.source, refreshedAt: Date.now() };
    scheduleSave(current);
  }
  if (openBoard === current) {
    drawBoard(current);
  }
}

/**
 * Takes the board's live captures again when they are older than LIVE_CAPTURE_STALE_MS (one after another; the main
 * process loads one page at a time anyway).
 */
async function refreshStaleLiveCaptures(current: OpenBoard): Promise<void> {
  const now = Date.now();
  for (const element of current.board.elements) {
    const isStale = element.kind === "image" && element.live !== undefined && now - element.live.refreshedAt > LIVE_CAPTURE_STALE_MS;
    if (isStale && openBoard === current) {
      await refreshLiveCapture(current, element.id);
    }
  }
}

/**
 * Draws the whole board again (a board has few elements; this keeps the code simple).
 */
function drawBoard(current: OpenBoard): void {
  const focusedId = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.id : undefined;
  current.world.querySelectorAll(".easel-item").forEach((item) => item.remove());
  current.strokes.replaceChildren();
  for (const element of current.board.elements) {
    if (element.kind === "stroke") {
      drawStroke(current, element);
    }
    if (element.kind === "text") {
      drawText(current, element);
    }
    if (element.kind === "image") {
      drawImage(current, element);
    }
  }
  if (focusedId !== undefined) {
    current.world.querySelector<HTMLElement>(`[data-id="${CSS.escape(focusedId)}"]`)?.focus();
  }
}

/**
 * Adds an element, selects it, draws and saves.
 */
function addElement(current: OpenBoard, element: EaselElement): void {
  current.board.elements.push(element);
  current.selectedId = element.id;
  drawBoard(current);
  scheduleSave(current);
}

/**
 * Places a picture (a data: URL) on the board at a point, no wider than MAX_PICTURE_WIDTH.
 */
function addPicture(current: OpenBoard, src: string, boardPoint: [number, number], sourceUrl: string | null, source: CaptureSource | null = null): void {
  const probe = new Image();
  probe.onload = () => {
    const scale = Math.min(1, MAX_PICTURE_WIDTH / probe.naturalWidth);
    const width = Math.round(probe.naturalWidth * scale);
    const height = Math.round(probe.naturalHeight * scale);
    const picture: EaselImage = { kind: "image", id: createElementId("image"), x: boardPoint[0], y: boardPoint[1], width: width, height: height, src: src, sourceUrl: sourceUrl };
    if (source !== null) {
      picture.live = { source: source, refreshedAt: Date.now() };
    }
    addElement(current, picture);
  };
  probe.src = src;
}

/**
 * Reads image files (picked, pasted or dropped) into pictures on the board.
 */
function addPictureFiles(current: OpenBoard, files: FileList | File[], boardPoint: [number, number]): void {
  for (const file of Array.from(files)) {
    if (!file.type.startsWith("image/")) {
      continue;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        addPicture(current, reader.result, boardPoint, null);
      }
    };
    reader.readAsDataURL(file);
  }
}

/**
 * The middle of what is on screen, on the board.
 */
function getViewCenter(current: OpenBoard): [number, number] {
  const box = current.viewport.getBoundingClientRect();
  return toBoardPoint(current, box.left + box.width / 2 - MAX_PICTURE_WIDTH / 4, box.top + box.height / 3);
}

/**
 * Pointer handling for the three tools: select and move or resize, add text, draw.
 */
function installPointerHandling(current: OpenBoard): void {
  let drag: { kind: "move" | "resize" | "pen" | "pan"; elementId: string | null; lastX: number; lastY: number } | null = null;
  current.viewport.addEventListener("pointerdown", (event) => {
    const target = event.target as Element;
    const resizeId = (target as HTMLElement).dataset?.resize;
    const itemId = target.closest<HTMLElement | SVGElement>("[data-id]")?.dataset.id ?? null;
    if (current.tool === "pen") {
      const stroke: EaselStroke = { kind: "stroke", id: createElementId("stroke"), points: [toBoardPoint(current, event.clientX, event.clientY)], color: current.color, width: PEN_WIDTH };
      current.board.elements.push(stroke);
      drag = { kind: "pen", elementId: stroke.id, lastX: event.clientX, lastY: event.clientY };
    } else if (current.tool === "text" && itemId === null) {
      const point = toBoardPoint(current, event.clientX, event.clientY);
      addElement(current, { kind: "text", id: createElementId("text"), x: point[0], y: point[1], width: TEXT_WIDTH, text: "", size: TEXT_SIZE, color: current.color });
      current.world.querySelector<HTMLElement>(`[data-id="${CSS.escape(current.selectedId ?? "")}"]`)?.focus();
      setTool(current, "select");
      event.preventDefault();
      return;
    } else if (resizeId !== undefined) {
      drag = { kind: "resize", elementId: resizeId, lastX: event.clientX, lastY: event.clientY };
    } else if (itemId !== null && itemId === current.selectedId && target.closest(".easel-text") !== null) {
      // A second click on a selected text box places the caret to edit it instead of moving it.
      return;
    } else if (itemId !== null) {
      current.selectedId = itemId;
      drag = { kind: "move", elementId: itemId, lastX: event.clientX, lastY: event.clientY };
      drawBoard(current);
    } else {
      current.selectedId = null;
      drag = { kind: "pan", elementId: null, lastX: event.clientX, lastY: event.clientY };
      drawBoard(current);
    }
    current.viewport.setPointerCapture(event.pointerId);
  });
  current.viewport.addEventListener("pointermove", (event) => {
    if (drag === null) {
      return;
    }
    const zoom = current.board.view.zoom;
    const deltaX = event.clientX - drag.lastX;
    const deltaY = event.clientY - drag.lastY;
    if (drag.kind === "pen" && Math.hypot(deltaX, deltaY) < MIN_POINT_DISTANCE_PX) {
      return;
    }
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    moveDrag(current, drag.kind, drag.elementId, deltaX / zoom, deltaY / zoom, event);
  });
  current.viewport.addEventListener("pointerup", () => {
    if (drag !== null) {
      drag = null;
      scheduleSave(current);
    }
  });
}

/**
 * One step of a drag: draw on, move or resize the element, or move the board.
 */
function moveDrag(current: OpenBoard, kind: "move" | "resize" | "pen" | "pan", elementId: string | null, boardDeltaX: number, boardDeltaY: number, event: PointerEvent): void {
  const element = current.board.elements.find((candidate) => candidate.id === elementId);
  if (kind === "pan") {
    current.board.view.x += boardDeltaX * current.board.view.zoom;
    current.board.view.y += boardDeltaY * current.board.view.zoom;
    applyView(current);
    return;
  }
  if (element === undefined) {
    return;
  }
  if (kind === "pen" && element.kind === "stroke") {
    element.points.push(toBoardPoint(current, event.clientX, event.clientY));
    current.strokes.querySelector(`[data-id="${CSS.escape(element.id)}"]`)?.remove();
    drawStroke(current, element);
    return;
  }
  if (kind === "resize" && element.kind === "image") {
    const ratio = element.height / element.width;
    element.width = Math.max(40, element.width + boardDeltaX);
    element.height = Math.round(element.width * ratio);
    drawBoard(current);
    return;
  }
  if (element.kind === "stroke") {
    element.points = element.points.map(([x, y]) => [x + boardDeltaX, y + boardDeltaY]);
  } else {
    element.x += boardDeltaX;
    element.y += boardDeltaY;
  }
  drawBoard(current);
}

/**
 * Two fingers move the board; a pinch (or ⌘ / ⌃ with the wheel) zooms around the pointer.
 */
function installWheelHandling(current: OpenBoard): void {
  current.viewport.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const view = current.board.view;
      if (!event.ctrlKey && !event.metaKey) {
        view.x -= event.deltaX;
        view.y -= event.deltaY;
        applyView(current);
        scheduleSave(current);
        return;
      }
      const pointerOnBoard = toBoardPoint(current, event.clientX, event.clientY);
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.zoom * (1 - event.deltaY * PINCH_ZOOM_SPEED)));
      const box = current.viewport.getBoundingClientRect();
      view.x = event.clientX - box.left - pointerOnBoard[0] * zoom;
      view.y = event.clientY - box.top - pointerOnBoard[1] * zoom;
      view.zoom = zoom;
      applyView(current);
      scheduleSave(current);
    },
    { passive: false },
  );
}

/**
 * Delete / Backspace removes the selected element (when no text is being typed into).
 */
function installKeyHandling(current: OpenBoard, editor: HTMLElement): void {
  editor.addEventListener("keydown", (event) => {
    const isTyping = document.activeElement instanceof HTMLElement && document.activeElement.isContentEditable;
    const isDeleteKey = event.key === "Delete" || event.key === "Backspace";
    if (!isDeleteKey || isTyping || current.selectedId === null) {
      return;
    }
    current.board.elements = current.board.elements.filter((element) => element.id !== current.selectedId);
    current.selectedId = null;
    drawBoard(current);
    scheduleSave(current);
  });
}

/**
 * Chooses a tool and shows which one is on.
 */
function setTool(current: OpenBoard, tool: Tool): void {
  current.tool = tool;
  current.viewport.dataset.tool = tool;
  for (const button of current.viewport.parentElement?.querySelectorAll<HTMLElement>("[data-tool-button]") ?? []) {
    button.classList.toggle("is-active", button.dataset.toolButton === tool);
  }
}

/**
 * The Library's captures as a little list over the board; a click puts one on it.
 */
async function showCapturePicker(current: OpenBoard, anchor: HTMLElement): Promise<void> {
  const existing = anchor.parentElement?.querySelector(".easel-capture-picker");
  if (existing !== null && existing !== undefined) {
    existing.remove();
    return;
  }
  const captures = await window.browserApi.listCaptures();
  const picker = createElement("div", "easel-capture-picker");
  if (captures.length === 0) {
    picker.append(createElement("p", "easel-picker-empty", "No captures yet. Take one from the Control Center."));
  }
  for (const capture of captures) {
    const choice = createElement("button", "easel-capture-choice");
    choice.title = capture.title;
    const thumbnail = document.createElement("img");
    thumbnail.src = capture.thumbnailUrl ?? "";
    thumbnail.alt = "";
    choice.append(thumbnail);
    choice.addEventListener("click", async () => {
      picker.remove();
      const src = await window.browserApi.readCapture(capture.id);
      if (src !== null) {
        addPicture(current, src, getViewCenter(current), capture.url, capture.source);
      }
    });
    picker.append(choice);
  }
  anchor.parentElement?.append(picker);
}

/**
 * The floating tool bar.
 */
function buildToolbar(current: OpenBoard, fileInput: HTMLInputElement): HTMLElement {
  const toolbar = createElement("div", "easel-toolbar");
  const tools: { tool: Tool; label: string; text: string }[] = [
    { tool: "select", label: "Select and move (Delete removes)", text: "↖" },
    { tool: "text", label: "Text: click the board", text: "T" },
    { tool: "pen", label: "Pen", text: "✎" },
  ];
  for (const entry of tools) {
    const button = createElement("button", "easel-button", entry.text);
    button.title = entry.label;
    button.dataset.toolButton = entry.tool;
    button.addEventListener("click", () => setTool(current, entry.tool));
    toolbar.append(button);
  }
  for (const color of PEN_COLORS) {
    const swatch = createElement("button", "easel-swatch");
    swatch.style.background = toCssColor(color);
    swatch.title = "Color";
    swatch.addEventListener("click", () => {
      current.color = color;
      toolbar.querySelectorAll(".easel-swatch").forEach((other) => other.classList.toggle("is-active", other === swatch));
    });
    swatch.classList.toggle("is-active", color === current.color);
    toolbar.append(swatch);
  }
  const pictureButton = createElement("button", "easel-button");
  pictureButton.title = "Add a picture (or paste / drop one)";
  pictureButton.append(createIcon("camera"));
  pictureButton.addEventListener("click", () => fileInput.click());
  const captureButton = createElement("button", "easel-button");
  captureButton.title = "Add a capture from the Library";
  captureButton.append(createIcon("capture"));
  captureButton.addEventListener("click", () => {
    showCapturePicker(current, captureButton).catch(() => undefined);
  });
  toolbar.append(pictureButton, captureButton, current.zoomLabel);
  return toolbar;
}

/**
 * Builds the editor for a board and loads it.
 */
function buildEditor(easelId: string): HTMLElement {
  const editor = createElement("div", "easel-editor");
  editor.tabIndex = -1;
  const viewport = createElement("div", "easel-viewport");
  const world = createElement("div", "easel-world");
  const strokes = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  strokes.classList.add("easel-strokes");
  world.append(strokes);
  viewport.append(world);
  const current: OpenBoard = { easelId: easelId, board: createEmptyBoard(), tool: "select", color: PEN_COLORS[0] as string, selectedId: null, world: world, strokes: strokes, viewport: viewport, zoomLabel: createElement("span", "easel-zoom", "100%"), refreshingIds: new Set() };
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/*";
  fileInput.multiple = true;
  fileInput.hidden = true;
  fileInput.addEventListener("change", () => {
    if (fileInput.files !== null) {
      addPictureFiles(current, fileInput.files, getViewCenter(current));
    }
    fileInput.value = "";
  });
  editor.append(viewport, buildToolbar(current, fileInput), fileInput);
  installPointerHandling(current);
  installWheelHandling(current);
  installKeyHandling(current, editor);
  editor.addEventListener("paste", (event) => {
    const files = event.clipboardData?.files;
    if (files !== undefined && files.length > 0) {
      event.preventDefault();
      addPictureFiles(current, files, getViewCenter(current));
    }
  });
  viewport.addEventListener("dragover", (event) => event.preventDefault());
  viewport.addEventListener("drop", (event) => {
    event.preventDefault();
    const files = event.dataTransfer?.files;
    if (files !== undefined) {
      addPictureFiles(current, files, toBoardPoint(current, event.clientX, event.clientY));
    }
  });
  openBoard = current;
  setTool(current, "select");
  window.browserApi
    .readEasel(easelId)
    .then((json) => {
      if (openBoard !== current) {
        return;
      }
      current.board = parseBoard(json);
      applyView(current);
      drawBoard(current);
      return refreshStaleLiveCaptures(current);
    })
    .catch(() => undefined);
  return editor;
}

/**
 * Reads a saved board, or an empty one when there is none or it cannot be read.
 */
function parseBoard(json: string): EaselBoard {
  try {
    const parsed = JSON.parse(json) as EaselBoard;
    const isBoard = parsed !== null && Array.isArray(parsed.elements) && typeof parsed.view?.zoom === "number";
    return isBoard ? parsed : createEmptyBoard();
  } catch {
    return createEmptyBoard();
  }
}

/**
 * Shows the board of an easel in the page card (keeping it while the same easel stays open), or removes it for null.
 */
export function showEaselEditor(slot: HTMLElement, easelId: string | null): void {
  if (easelId === (openBoard?.easelId ?? null)) {
    return;
  }
  openBoard = null;
  slot.querySelector(".easel-editor")?.remove();
  if (easelId !== null) {
    slot.append(buildEditor(easelId));
  }
}
