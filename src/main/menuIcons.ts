/**
 * WHY this file exists:
 *   macOS menus show small SF Symbols next to their items (Arc's do, and current macOS does it for its own menus).
 *   Our native menus get the same: this file finds the symbol for an item by its label and renders it, through
 *   macOS, as a template image (it follows the menu's light or dark look and the highlight).
 *
 * Data source:
 *   MENU_SYMBOLS (our pick of SF Symbol names per label) and macOS's symbol renderer.
 *
 * Data flow:
 *   menus.ts / overlayController.ts / page right-click → addMenuIcons(template) → Menu.buildFromTemplate → popup
 */
import { nativeImage } from "electron";
import type { MenuItem, MenuItemConstructorOptions, NativeImage } from "electron";

/** Item label → SF Symbol. Labels not listed get no icon. */
const MENU_SYMBOLS: Record<string, string> = {
  "Pin Tab": "pin",
  "Unpin Tab": "pin.slash",
  "Move to Pinned": "pin",
  "Add to Favorites": "star",
  "Remove from Favorites": "star.slash",
  "Back to Pinned URL": "arrow.uturn.backward",
  "Rename…": "pencil",
  "Rename Space…": "pencil",
  "Copy Link": "link",
  "Copy Link Address": "link",
  Duplicate: "plus.square.on.square",
  "Close Tab": "xmark",
  "Close Page": "xmark",
  "Delete (Move to Archive)": "archivebox",
  "Move to Space": "rectangle.stack",
  "Split View with": "rectangle.split.2x1",
  "Separate from Split View": "rectangle",
  "New Tab": "plus",
  "New Note": "note.text",
  "New Easel": "scribble.variable",
  "New Folder": "folder.badge.plus",
  "New Live Folder": "dot.radiowaves.left.and.right",
  "GitHub Pull Requests": "arrow.triangle.pull",
  "GitHub Review Requests": "eye",
  "GitHub Issues Assigned to You": "smallcircle.filled.circle",
  "Feed from This Page": "dot.radiowaves.up.forward",
  "Refresh Now": "arrow.clockwise",
  "Show Removed Items": "eye",
  "Delete Live Folder": "trash",
  "Remove from Live Folder": "minus.circle",
  "New Space": "square.stack.3d.up",
  "Edit Theme…": "paintpalette",
  "Change Icon…": "face.smiling",
  "Theme Presets": "swatchpalette",
  "Delete Space…": "trash",
  "Delete Folder (Tabs Move to Archive)": "trash",
  Reload: "arrow.clockwise",
  "Hard Reload": "arrow.clockwise.circle",
  "Empty Cache and Hard Reload": "trash.circle",
  Back: "chevron.left",
  Forward: "chevron.right",
  "Open Link in New Tab": "plus.rectangle.on.rectangle",
  "Open Link in Background Tab": "rectangle.on.rectangle",
  "Open Image in New Tab": "photo",
  "Copy Image": "doc.on.doc",
  "Copy Image Address": "link",
  "Inspect Element": "scope",
  "Zap Elements": "wand.and.rays",
  "Edit Boost…": "paintbrush.pointed",
  "Developer Tools": "hammer",
  "Zoom In": "plus.magnifyingglass",
  "Zoom Out": "minus.magnifyingglass",
  "Clear Site Data and Reload": "trash",
};

/** Symbols are rendered at 2× (a 13 pt symbol arrives about 26 pixels tall), like symbols.ts. */
const SYMBOL_SCALE_FACTOR = 2;

/** Rendered icons, by symbol name (null: macOS has no such symbol). */
const iconCache = new Map<string, NativeImage | null>();

/**
 * The menu icon for a symbol: a template image marked as 2× so it shows at the menu's size.
 */
function getSymbolIcon(symbolName: string): NativeImage | null {
  const cached = iconCache.get(symbolName);
  if (cached !== undefined) {
    return cached;
  }
  const rendered = nativeImage.createFromNamedImage(symbolName);
  if (rendered.isEmpty()) {
    iconCache.set(symbolName, null);
    return null;
  }
  const icon = nativeImage.createEmpty();
  icon.addRepresentation({ scaleFactor: SYMBOL_SCALE_FACTOR, buffer: rendered.toPNG() });
  icon.setTemplateImage(true);
  iconCache.set(symbolName, icon);
  return icon;
}

/**
 * Adds icons to a menu template (and its submenus) by label. Items that already have an icon keep it.
 */
export function addMenuIcons<Item extends MenuItemConstructorOptions | MenuItem>(template: Item[]): Item[] {
  for (const item of template) {
    // Only our own plain templates: built MenuItems (extensions' items) stay as they are.
    if (Object.getPrototypeOf(item) !== Object.prototype) {
      continue;
    }
    const options = item as MenuItemConstructorOptions;
    if (Array.isArray(options.submenu)) {
      addMenuIcons(options.submenu);
    }
    const symbolName = options.label === undefined ? undefined : MENU_SYMBOLS[options.label];
    if (symbolName === undefined || options.icon !== undefined) {
      continue;
    }
    const icon = getSymbolIcon(symbolName);
    if (icon !== null) {
      options.icon = icon;
    }
  }
  return template;
}
