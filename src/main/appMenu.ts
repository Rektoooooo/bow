/**
 * WHY this file exists:
 *   Keyboard shortcuts must work while a web page has focus, and keys pressed in a page go to the page. Only
 *   application-menu accelerators reach the app first, so every shortcut lives here as a menu item. The keys follow
 *   Arc's published shortcut list (docs/research/arc-findings.md §4). The Edit menu's roles are also what makes
 *   copy and paste work inside pages on macOS.
 *
 * Data source:
 *   The AppMenuCommands that main.ts passes in.
 *
 * Data flow:
 *   app ready → installAppMenu(commands) → user presses ⌘T → commands.openCommandBar("newTab")
 */
import { Menu } from "electron";
import type { MenuItemConstructorOptions } from "electron";
import type { NavigationCommand } from "../shared/actions";

/** What the menu items do. main.ts implements each one. */
export interface AppMenuCommands {
  openCommandBar(mode: "newTab" | "editUrl" | "splitWith"): void;
  closeSelectedTab(): void;
  reopenClosedTab(): void;
  togglePinSelected(): void;
  copySelectedUrl(format: "plain" | "markdown"): void;
  duplicateSelected(): void;
  cycleTab(offset: number): void;
  selectTabNumber(tabNumber: number): void;
  /** ⌃Tab / ⌃⇧Tab: the recent-tab switcher, one step forward or back. */
  switchRecentTab(step: number): void;
  clearTodayTabs(): void;
  addSplitPane(): void;
  closeSplitPane(): void;
  switchSpaceByOffset(offset: number): void;
  switchSpaceByNumber(spaceNumber: number): void;
  newSpace(): void;
  newFolder(): void;
  toggleSidebar(): void;
  toggleFullUrls(): void;
  navigate(command: NavigationCommand): void;
  forceReload(): void;
  zoom(direction: "in" | "out" | "reset"): void;
  toggleDevTools(): void;
  openFind(): void;
  findNext(forward: boolean): void;
  openLibrary(): void;
  openLittleWindow(): void;
  /** File › New Window (⌘N): another full main window. */
  openNewWindow(): void;
  /** File › Close Window (⇧⌘W): the window in front. */
  closeWindow(): void;
  importFromArc(): void;
  newNote(): void;
  newEasel(): void;
  /** The import menu's items (Arc first); the File menu shows the browser part. */
  buildImportMenu(): MenuItemConstructorOptions[];
  openUrlInNewTab(url: string): void;
  openPeekAsTab(): void;
  openPrivateWindow(): void;
  zapElements(): void;
  setAsDefaultBrowser(): void;
  printPage(): void;
}

/** Where the Help menu points. */
const PROJECT_URL = "https://github.com/Rektoooooo/sidebar-browser";

/** ⌘1 … ⌘9 and ⌃1 … ⌃9. */
const NUMBER_KEYS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

/**
 * Builds hidden menu items for numbered shortcuts. Hidden items keep their accelerators on macOS
 * (acceleratorWorksWhenHidden), so nine "Tab N" entries do not clutter the menu.
 */
function buildNumberedItems(labelPrefix: string, modifier: string, onSelect: (number: number) => void): MenuItemConstructorOptions[] {
  return NUMBER_KEYS.map((number) => ({
    label: `${labelPrefix} ${number}`,
    accelerator: `${modifier}+${number}`,
    visible: false,
    acceleratorWorksWhenHidden: true,
    click: () => onSelect(number),
  }));
}

/**
 * Builds the whole menu bar.
 */
function buildTemplate(commands: AppMenuCommands): MenuItemConstructorOptions[] {
  return [
    {
      role: "appMenu",
      submenu: [
        { role: "about" },
        { type: "separator" },
        { label: "Set as Default Browser…", click: () => commands.setAsDefaultBrowser() },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "File",
      submenu: [
        { label: "New Tab", accelerator: "CommandOrControl+T", click: () => commands.openCommandBar("newTab") },
        { label: "New Window", accelerator: "CommandOrControl+N", click: () => commands.openNewWindow() },
        { label: "New Little Window", accelerator: "CommandOrControl+Alt+N", click: () => commands.openLittleWindow() },
        { label: "New Note", accelerator: "Control+Command+N", click: () => commands.newNote() },
        { label: "New Easel", click: () => commands.newEasel() },
        { label: "New Private Window", accelerator: "CommandOrControl+Shift+N", click: () => commands.openPrivateWindow() },
        { label: "Open Location…", accelerator: "CommandOrControl+L", click: () => commands.openCommandBar("editUrl") },
        { label: "Open Peek as Tab", accelerator: "CommandOrControl+O", click: () => commands.openPeekAsTab() },
        { type: "separator" },
        { label: "Close Tab", accelerator: "CommandOrControl+W", click: () => commands.closeSelectedTab() },
        { label: "Close Window", accelerator: "CommandOrControl+Shift+W", click: () => commands.closeWindow() },
        { label: "Reopen Closed Tab", accelerator: "CommandOrControl+Shift+T", click: () => commands.reopenClosedTab() },
        { type: "separator" },
        { label: "Import from Arc…", click: () => commands.importFromArc() },
        { label: "Import From Browser", submenu: commands.buildImportMenu().slice(2) },
        { type: "separator" },
        { label: "Print…", accelerator: "CommandOrControl+P", click: () => commands.printPage() },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "pasteAndMatchStyle" },
        { role: "selectAll" },
        { type: "separator" },
        { label: "Find…", accelerator: "CommandOrControl+F", click: () => commands.openFind() },
        { label: "Find Next", accelerator: "CommandOrControl+G", click: () => commands.findNext(true) },
        { label: "Find Previous", accelerator: "CommandOrControl+Shift+G", click: () => commands.findNext(false) },
        { type: "separator" },
        { label: "Copy URL", accelerator: "CommandOrControl+Shift+C", click: () => commands.copySelectedUrl("plain") },
        { label: "Copy URL as Markdown", accelerator: "CommandOrControl+Shift+Alt+C", click: () => commands.copySelectedUrl("markdown") },
      ],
    },
    {
      label: "View",
      submenu: [
        { label: "Toggle Sidebar", accelerator: "CommandOrControl+S", click: () => commands.toggleSidebar() },
        { label: "Toggle Full URLs", click: () => commands.toggleFullUrls() },
        { type: "separator" },
        { label: "Reload Page", accelerator: "CommandOrControl+R", click: () => commands.navigate("reload") },
        { label: "Force Reload Page", accelerator: "CommandOrControl+Shift+R", click: () => commands.forceReload() },
        { label: "Stop Loading", accelerator: "CommandOrControl+.", click: () => commands.navigate("stop") },
        { type: "separator" },
        { label: "Zoom In", accelerator: "CommandOrControl+Plus", click: () => commands.zoom("in") },
        { label: "Zoom In", accelerator: "CommandOrControl+=", visible: false, acceleratorWorksWhenHidden: true, click: () => commands.zoom("in") },
        { label: "Zoom Out", accelerator: "CommandOrControl+-", click: () => commands.zoom("out") },
        { label: "Actual Size", accelerator: "CommandOrControl+0", click: () => commands.zoom("reset") },
        { type: "separator" },
        { label: "Developer Tools", accelerator: "CommandOrControl+Alt+I", click: () => commands.toggleDevTools() },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "History",
      submenu: [
        { label: "Back", accelerator: "CommandOrControl+[", click: () => commands.navigate("back") },
        { label: "Forward", accelerator: "CommandOrControl+]", click: () => commands.navigate("forward") },
        { type: "separator" },
        { label: "Library and Archive", accelerator: "CommandOrControl+Shift+L", click: () => commands.openLibrary() },
        { label: "History", accelerator: "CommandOrControl+Y", click: () => commands.openLibrary() },
      ],
    },
    {
      label: "Tabs",
      submenu: [
        { label: "Pin / Unpin Tab", accelerator: "CommandOrControl+D", click: () => commands.togglePinSelected() },
        { label: "Duplicate Tab", click: () => commands.duplicateSelected() },
        { label: "Clear Today Tabs", accelerator: "CommandOrControl+Shift+K", click: () => commands.clearTodayTabs() },
        { type: "separator" },
        { label: "Next Tab", accelerator: "CommandOrControl+Alt+Down", click: () => commands.cycleTab(1) },
        { label: "Previous Tab", accelerator: "CommandOrControl+Alt+Up", click: () => commands.cycleTab(-1) },
        { label: "Recent Tab", accelerator: "Control+Tab", click: () => commands.switchRecentTab(1) },
        { label: "Recent Tab, Backwards", accelerator: "Control+Shift+Tab", click: () => commands.switchRecentTab(-1) },
        ...buildNumberedItems("Tab", "CommandOrControl", (number) => commands.selectTabNumber(number)),
        { type: "separator" },
        { label: "Add Split View", accelerator: "Control+Shift+=", click: () => commands.addSplitPane() },
        { label: "Close Split Pane", accelerator: "Control+Shift+-", click: () => commands.closeSplitPane() },
        { type: "separator" },
        { label: "New Folder", click: () => commands.newFolder() },
      ],
    },
    {
      label: "Spaces",
      submenu: [
        { label: "Next Space", accelerator: "CommandOrControl+Alt+Right", click: () => commands.switchSpaceByOffset(1) },
        { label: "Previous Space", accelerator: "CommandOrControl+Alt+Left", click: () => commands.switchSpaceByOffset(-1) },
        ...buildNumberedItems("Space", "Control", (number) => commands.switchSpaceByNumber(number)),
        { type: "separator" },
        { label: "New Space", click: () => commands.newSpace() },
      ],
    },
    { role: "windowMenu" },
    { role: "help", submenu: [{ label: "Bow on GitHub", click: () => commands.openUrlInNewTab(PROJECT_URL) }] },
  ];
}

/**
 * Installs the menu bar.
 */
export function installAppMenu(commands: AppMenuCommands): void {
  const menu = Menu.buildFromTemplate(buildTemplate(commands));
  Menu.setApplicationMenu(menu);
}
