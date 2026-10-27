/**
 * WHY this file exists:
 *   Arc lets a Space show an emoji or an icon (its icon picker has Emoji and Icon tabs). Our icons are Apple's SF
 *   Symbols, our own selection (nothing of Arc's artwork), plus a planet we draw ourselves because SF Symbols has
 *   none (the user's Main Space uses Arc's planet). A Space stores an icon as "icon:<name>" in Space.icon, an emoji
 *   as itself, so the saved shape does not change.
 *
 * Data source:
 *   Our choice of symbols and emoji; every symbol name was checked to exist on the user's macOS (2026-10-27).
 *
 * Data flow:
 *   icon picker → setSpaceIcon("icon:star") → sidebar / Library draw it (renderer/spaceIcon.ts); menus and other
 *   text-only places show describeSpaceIconAsText() instead; arcImport.ts maps Arc's icon names here.
 */

/** Plain text for an icon name this version does not know (a newer version's icon). Our default Space mark. */
const UNKNOWN_ICON_TEXT = "✦";

/** Space.icon values that name one of our icons start with this. */
export const SPACE_ICON_PREFIX = "icon:";

/** One icon a Space can show: the SF Symbol macOS draws for it (null: we draw it), and an emoji for plain text. */
export interface SpaceIconChoice {
  name: string;
  symbol: string | null;
  emoji: string;
}

/** The Icon tab, eight to a row. */
export const SPACE_ICON_CHOICES: SpaceIconChoice[] = [
  { name: "star", symbol: "star.fill", emoji: "⭐" },
  { name: "bookmark", symbol: "bookmark.fill", emoji: "🔖" },
  { name: "heart", symbol: "heart.fill", emoji: "❤️" },
  { name: "flag", symbol: "flag.fill", emoji: "🚩" },
  { name: "bolt", symbol: "bolt.fill", emoji: "⚡" },
  { name: "triangle", symbol: "triangle.fill", emoji: "🔺" },
  { name: "asterisk", symbol: "asterisk", emoji: "✳️" },
  { name: "bell", symbol: "bell.fill", emoji: "🔔" },
  { name: "bulb", symbol: "lightbulb.fill", emoji: "💡" },
  { name: "shapes", symbol: "square.on.circle.fill", emoji: "🔷" },
  { name: "grid", symbol: "square.grid.2x2.fill", emoji: "🔲" },
  { name: "dots", symbol: "circle.grid.3x3.fill", emoji: "⚫" },
  { name: "layers", symbol: "square.stack.3d.up.fill", emoji: "🗂️" },
  { name: "database", symbol: "cylinder.split.1x2.fill", emoji: "🗄️" },
  { name: "rectangle", symbol: "rectangle.fill", emoji: "▬" },
  { name: "copies", symbol: "square.on.square.fill", emoji: "📑" },
  { name: "folder", symbol: "folder.fill", emoji: "📁" },
  { name: "tray", symbol: "tray.fill", emoji: "📥" },
  { name: "calendar", symbol: "calendar", emoji: "📅" },
  { name: "mail", symbol: "envelope.fill", emoji: "✉️" },
  { name: "check", symbol: "checkmark.square.fill", emoji: "✅" },
  { name: "document", symbol: "doc.fill", emoji: "📄" },
  { name: "book", symbol: "book.fill", emoji: "📖" },
  { name: "chat", symbol: "bubble.left.fill", emoji: "💬" },
  { name: "people", symbol: "person.2.fill", emoji: "👥" },
  { name: "terminal", symbol: "apple.terminal.fill", emoji: "💻" },
  { name: "tools", symbol: "wrench.and.screwdriver.fill", emoji: "🛠️" },
  { name: "square", symbol: "square.fill", emoji: "⬛" },
  { name: "drop", symbol: "drop.fill", emoji: "💧" },
  { name: "circle", symbol: "circle.fill", emoji: "⚪" },
  { name: "moon", symbol: "moon.fill", emoji: "🌙" },
  { name: "sun", symbol: "sun.max.fill", emoji: "☀️" },
  { name: "planet", symbol: null, emoji: "🪐" },
  { name: "leaf", symbol: "leaf.fill", emoji: "🍃" },
  { name: "cloud", symbol: "cloud.fill", emoji: "☁️" },
  { name: "paw", symbol: "pawprint.fill", emoji: "🐾" },
  { name: "basket", symbol: "basket.fill", emoji: "🧺" },
  { name: "gift", symbol: "gift.fill", emoji: "🎁" },
  { name: "bed", symbol: "bed.double.fill", emoji: "🛏️" },
  { name: "food", symbol: "fork.knife", emoji: "🍴" },
  { name: "fitness", symbol: "dumbbell.fill", emoji: "🏋️" },
  { name: "travel", symbol: "airplane", emoji: "✈️" },
  { name: "music", symbol: "music.note", emoji: "🎵" },
  { name: "palette", symbol: "paintpalette.fill", emoji: "🎨" },
  { name: "video", symbol: "video.fill", emoji: "🎬" },
  { name: "bandage", symbol: "bandage.fill", emoji: "🩹" },
  { name: "code", symbol: "chevron.left.forwardslash.chevron.right", emoji: "👨‍💻" },
  { name: "ball", symbol: "baseball.fill", emoji: "⚾" },
  { name: "cloudOutline", symbol: "cloud", emoji: "☁️" },
  { name: "map", symbol: "map.fill", emoji: "🗺️" },
  { name: "flame", symbol: "flame.fill", emoji: "🔥" },
  { name: "game", symbol: "gamecontroller.fill", emoji: "🎮" },
  { name: "school", symbol: "graduationcap.fill", emoji: "🎓" },
  { name: "thumbsUp", symbol: "hand.thumbsup.fill", emoji: "👍" },
  { name: "tram", symbol: "tram.fill", emoji: "🚋" },
  { name: "globe", symbol: "globe.europe.africa.fill", emoji: "🌍" },
];

/** The Emoji tab, eight to a row. Our choice of common ones. */
export const SPACE_EMOJI_CHOICES: string[] = [
  "🏠", "💼", "🎨", "🎮", "🎵", "📚", "✈️", "🍕",
  "⚽", "🧪", "💻", "📷", "🛒", "💡", "🔥", "🌱",
  "🌙", "☀️", "⭐", "❤️", "🪐", "🚀", "🧠", "📝",
  "📈", "🎬", "🏋️", "🐶", "🐱", "🌍", "🏖️", "⛰️",
  "🍔", "☕", "🍷", "🎓", "🛠️", "💰", "🧾", "📅",
  "📌", "🔒", "🔔", "🎁", "🎉", "🧘", "🚗", "🚲",
  "🏀", "🎧", "📺", "🕹️", "🌸", "🍀", "🦊", "✦",
];

/**
 * The icon a Space.icon value names, or null for an emoji (or an unknown name).
 * Example: "icon:star" → the star choice; "🏠" → null
 */
export function findSpaceIconChoice(icon: string): SpaceIconChoice | null {
  if (!icon.startsWith(SPACE_ICON_PREFIX)) {
    return null;
  }
  const name = icon.slice(SPACE_ICON_PREFIX.length);
  return SPACE_ICON_CHOICES.find((choice) => choice.name === name) ?? null;
}

/**
 * How a Space's icon reads in plain text (menus, Command Bar titles): an icon's emoji, or the emoji itself.
 * Example: "icon:planet" → "🪐"; "🏠" → "🏠"
 */
export function describeSpaceIconAsText(icon: string): string {
  if (!icon.startsWith(SPACE_ICON_PREFIX)) {
    return icon;
  }
  const choice = findSpaceIconChoice(icon);
  return choice === null ? UNKNOWN_ICON_TEXT : choice.emoji;
}
