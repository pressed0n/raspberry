"use client";
/* The icon vocabulary.
   ---------------------------------------------------------------------------
   An icon is stored as a **name**, never as a component: `database_properties.icon`,
   `databases.title_property` and `pages.icon` hold strings, so the server never has to
   know what a "check" looks like and changing the icon set is a client-only change.

   This file is the whole set. It is deliberately bigger than the property *types*
   need — the picker is a searchable grid, and a grid with twelve things in it is a
   list wearing a costume. Property types still resolve their defaults from here
   (`DEFAULT_PROPERTY_ICON`), so a column is never iconless.

   Adding an icon is a one-line change: put the component in `PROPERTY_ICONS` and the
   name in `PROPERTY_ICON_CHOICES`. Nothing else in the app knows the names.
   --------------------------------------------------------------------------- */
import {
  Activity, AlarmClock, Apple, Archive, Armchair, AtSign, Award, BarChart3, Battery,
  Bed, Bell, Bike, Book, BookOpen, Bookmark, Box, Brain, Briefcase, Brush, Bug,
  Building, Cake, Calculator, Calendar, CalendarDays, Camera, Car, Check, Circle,
  CircleCheck, CircleDot, Clock, Cloud, Code, Coffee, Coins, Compass, Cpu,
  CreditCard, Crosshair, Database, Dice5, DollarSign, Download, Droplet, Dumbbell,
  Eye, EyeOff, Film, FileText, Fingerprint, Flag, Flame, FlaskConical, Footprints,
  Gamepad2, Gift, Globe, GraduationCap, Hammer, Hash, Headphones, Heart, Home,
  Hourglass, Image, Inbox, Key, Layers, Leaf, Lightbulb, LineChart, Link, List,
  ListChecks, Lock, Mail, Map, MapPin, Medal, Megaphone, MessageCircle, Mic,
  Microscope, Moon, Music, NotebookPen, Palette, Paperclip, PartyPopper, Percent, PenTool,
  Phone, PieChart, Plane, Plug, Printer, Puzzle, Receipt, RefreshCw, Repeat, Rocket,
  Ruler, Scale, School, Scissors, Search, Send, Server, Settings, Shield,
  ShoppingBag, ShoppingCart, Shuffle, Sigma, Smile, Snowflake, Sparkles, Sprout,
  Star, Sun, Tag, Target, Telescope, Terminal, Thermometer, ThumbsUp, Timer, Trash2,
  Trees, TrendingUp, Trophy, Truck, Type, Unlock, User, Users, Utensils, Video,
  Wallet, Waves, Wifi, Wind, Wrench, Zap,
  type LucideIcon,
} from "lucide-react";

export const PROPERTY_ICONS: Record<string, LucideIcon> = {
  /* Page icons. `pages.icon` uses its own small vocabulary (`PAGE_ICONS` in
     `page-glyph.tsx`), and an entry *is* a page — so every name a page can carry has to
     resolve here too, or a row whose sidebar shows a document would show this fallback
     glyph in the table. `file` is the default on every page ever created. */
  file: FileText,
  /* text-ish */
  text: Type, hash: Hash, tag: Tag, list: List, check: ListChecks, circle: Circle,
  "circle-dot": CircleDot, "circle-check": CircleCheck, sigma: Sigma, percent: Percent,
  "dollar-sign": DollarSign, calculator: Calculator, ruler: Ruler, scale: Scale,
  /* date-ish */
  calendar: Calendar, "calendar-days": CalendarDays, clock: Clock, "alarm-clock": AlarmClock,
  hourglass: Hourglass, timer: Timer,
  /* people / contact */
  user: User, users: Users, mail: Mail, "at-sign": AtSign, phone: Phone, send: Send,
  inbox: Inbox, "message-circle": MessageCircle, megaphone: Megaphone, bell: Bell,
  /* things */
  /* A paperclip, not a folder: this column holds attachments, and `folder` in this app is a
     *page container*. A column icon that means "a box of pages" over cells that hold photos is
     the same mistake as the `+` in a column of icons that meant "add a row". */
  files: Paperclip, "file-text": Book, image: Image, film: Film, video: Video, mic: Mic,
  music: Music, headphones: Headphones, camera: Camera, printer: Printer, palette: Palette,
  brush: Brush, "pen-tool": PenTool, scissors: Scissors, puzzle: Puzzle, "gamepad-2": Gamepad2,
  dice: Dice5, gift: Gift, "party-popper": PartyPopper,
  /* charts / data */
  activity: Activity, "bar-chart": BarChart3, "line-chart": LineChart, "pie-chart": PieChart,
  "trending-up": TrendingUp, layers: Layers, database: Database, server: Server,
  filter: Search, code: Code, terminal: Terminal, cpu: Cpu,
  /* places */
  "map-pin": MapPin, map: Map, globe: Globe, compass: Compass, home: Home, building: Building,
  briefcase: Briefcase, school: School, "graduation-cap": GraduationCap,
  /* energy / weather */
  zap: Zap, flame: Flame, sun: Sun, moon: Moon, cloud: Cloud, wind: Wind, waves: Waves,
  droplet: Droplet, snowflake: Snowflake, "refresh-cw": RefreshCw,
  /* objects */
  package: Box, archive: Archive, rocket: Rocket, bookmark: Bookmark, "book-open": BookOpen,
  notebook: NotebookPen, key: Key, lock: Lock, unlock: Unlock, shield: Shield,
  settings: Settings, wrench: Wrench, hammer: Hammer, plug: Plug, battery: Battery,
  "credit-card": CreditCard, wallet: Wallet, "shopping-cart": ShoppingCart,
  "shopping-bag": ShoppingBag, receipt: Receipt, coins: Coins, trash: Trash2,
  /* life */
  leaf: Leaf, sprout: Sprout, trees: Trees, apple: Apple, coffee: Coffee, cake: Cake,
  utensils: Utensils, "flask-conical": FlaskConical, microscope: Microscope,
  telescope: Telescope, pill: Target, stethoscope: Heart, dumbbell: Dumbbell,
  bike: Bike, car: Car, plane: Plane, truck: Truck, bed: Bed, armchair: Armchair,
  /* signals */
  flag: Flag, star: Star, heart: Heart, lightbulb: Lightbulb, sparkles: Sparkles,
  target: Target, crosshair: Crosshair, search: Search, eye: Eye, "eye-off": EyeOff,
  "thumbs-up": ThumbsUp, smile: Smile, brain: Brain, bug: Bug, fingerprint: Fingerprint,
  footprints: Footprints, award: Award, medal: Medal, trophy: Trophy,
  /* verbs */
  link: Link, shuffle: Shuffle, repeat: Repeat, download: Download, thermometer: Thermometer,
  "map-pinned": MapPin,
};

/** No icon chosen. Distinct from "absent", which means "use the type's default". */
export const NO_ICON = "none";

/**
 * The picker's order: grouped by what a person is looking for rather than alphabetical,
 * because "I want a date icon" is the actual query. Names only — the grid resolves them.
 */
export const PROPERTY_ICON_CHOICES: readonly string[] = [
  "text", "hash", "tag", "list", "check", "circle", "circle-dot", "circle-check",
  "sigma", "percent", "dollar-sign", "calculator", "ruler", "scale",
  "calendar", "calendar-days", "clock", "alarm-clock", "hourglass", "timer",
  "user", "users", "mail", "at-sign", "phone", "send", "inbox", "message-circle",
  "megaphone", "bell",
  "files", "file", "file-text", "image", "film", "video", "mic", "music", "headphones",
  "camera", "printer", "palette", "brush", "pen-tool", "scissors", "puzzle",
  "gamepad-2", "dice", "gift", "party-popper",
  "activity", "bar-chart", "line-chart", "pie-chart", "trending-up", "layers",
  "database", "server", "filter", "code", "terminal", "cpu",
  "map-pin", "map", "globe", "compass", "home", "building", "briefcase", "school",
  "graduation-cap",
  "zap", "flame", "sun", "moon", "cloud", "wind", "waves", "droplet", "snowflake",
  "refresh-cw",
  "package", "archive", "rocket", "bookmark", "book-open", "notebook", "key", "lock",
  "unlock", "shield", "settings", "wrench", "hammer", "plug", "battery",
  "credit-card", "wallet", "shopping-cart", "shopping-bag", "receipt", "coins", "trash",
  "leaf", "sprout", "trees", "apple", "coffee", "cake", "utensils", "flask-conical",
  "microscope", "telescope", "pill", "stethoscope", "dumbbell", "bike", "car",
  "plane", "truck", "bed", "armchair",
  "flag", "star", "heart", "lightbulb", "sparkles", "target", "crosshair", "search",
  "eye", "eye-off", "thumbs-up", "smile", "brain", "bug", "fingerprint", "footprints",
  "award", "medal", "trophy",
  "link", "shuffle", "repeat", "download", "thermometer",
];

/** What each property *type* looks like until someone picks something else. */
export const DEFAULT_PROPERTY_ICON: Record<string, string> = {
  text: "text",
  number: "hash",
  select: "circle-dot",
  multiSelect: "list",
  status: "circle-check",
  date: "calendar",
  person: "user",
  files: "files",
  checkbox: "check",
  url: "link",
  email: "mail",
  phone: "phone",
  place: "map-pin",
  formula: "sigma",
  relation: "layers",
  rollup: "activity",
  createdTime: "clock",
};

/** The name a property renders with: its own, else its type's default. */
export function iconNameFor(property: { type: string; icon?: string }): string {
  const chosen = property.icon?.trim();
  return chosen && chosen !== NO_ICON ? chosen : (DEFAULT_PROPERTY_ICON[property.type] ?? "text");
}

export function PropertyIcon({ name, size = 14, className }: { name: string; size?: number; className?: string }) {
  const Icon = PROPERTY_ICONS[name] ?? Type;
  return <Icon size={size} className={className} aria-hidden="true" />;
}

/** Every name the picker can offer, de-duplicated and in picker order. */
export function allIconNames(): string[] {
  const seen = new Set<string>();
  for (const name of PROPERTY_ICON_CHOICES) if (PROPERTY_ICONS[name]) seen.add(name);
  return [...seen];
}

/**
 * Filter the grid.
 *
 * Matches the stored name, so "cal" finds `calendar` and `calendar-days` without anyone
 * maintaining a keyword table that would rot the first time a name changed.
 */
export function searchIcons(query: string): string[] {
  const names = allIconNames();
  const needle = query.trim().toLowerCase();
  if (!needle) return names;
  const words = needle.split(/\s+/);
  return names.filter((name) => {
    const haystack = name.replace(/-/g, " ");
    return words.every((word) => haystack.includes(word));
  });
}
