import { commands, type Theme } from "@/bindings";
import { readTextFile, BaseDirectory } from "@tauri-apps/plugin-fs";
import { platform } from "@tauri-apps/plugin-os";

/**
 * Appearance theme handling.
 *
 * Handy already ships a full light palette and a full dark palette (see
 * `App.css`). This module lets the user pick which one is used instead of
 * always following the OS:
 *  - `system` follows Omarchy's palette on Linux when available, otherwise
 *    the `prefers-color-scheme` media query governs.
 *  - `light` / `dark` set `data-theme` on the document root, whose
 *    higher-specificity CSS selectors win over the media query.
 *
 * The choice is persisted in `AppSettings` (source of truth) and mirrored to
 * localStorage so it can be applied synchronously on boot, before React mounts,
 * avoiding a flash of the wrong palette.
 */

export const THEME_STORAGE_KEY = "handy.theme";

export const THEME_OPTIONS: Theme[] = ["system", "light", "dark"];

const isTheme = (value: unknown): value is Theme =>
  value === "system" || value === "light" || value === "dark";

let currentTheme: Theme = "system";
let readingOmarchy = false;
const omarchyTokens = {
  "--color-background": "background",
  "--color-text": "foreground",
  "--color-logo-primary": "accent",
  "--color-logo-stroke": "foreground",
  "--color-background-ui": "accent",
  "--color-mid-gray": "foreground",
} as const;

const clearOmarchyTheme = (): void => {
  const root = document.documentElement;
  delete root.dataset.omarchy;
  for (const token of Object.keys(omarchyTokens))
    root.style.removeProperty(token);
};

/** Read the palette, including after Omarchy atomically replaces its theme. */
export const syncOmarchyTheme = async (): Promise<void> => {
  if (currentTheme !== "system" || platform() !== "linux" || readingOmarchy)
    return;
  readingOmarchy = true;
  try {
    const source = await readTextFile(
      ".local/state/omarchy/current/theme/colors.toml",
      { baseDir: BaseDirectory.Home },
    );
    // Only accept literal hex colors from Omarchy's flat palette, never CSS.
    const colors = Object.fromEntries(
      [
        ...source.matchAll(
          /^\s*(\w+)\s*=\s*["'](#[\da-fA-F]{6})["']\s*(?:#.*)?$/gm,
        ),
      ].map((match) => [match[1], match[2]]),
    );
    if (!colors.background || !colors.foreground || !colors.accent)
      throw new Error("Incomplete Omarchy palette");
    if (currentTheme !== "system") return;
    const root = document.documentElement;
    const mode = source.match(
      /^\s*mode\s*=\s*["'](light|dark)["']\s*(?:#.*)?$/m,
    )?.[1];
    const rgb = colors.background
      .slice(1)
      .match(/../g)!
      .map((hex) => parseInt(hex, 16));
    root.dataset.theme =
      mode ??
      (rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114 > 128
        ? "light"
        : "dark");
    root.dataset.omarchy = "true";
    for (const [token, key] of Object.entries(omarchyTokens))
      root.style.setProperty(token, colors[key]);
  } catch {
    // Other Linux desktops and incomplete theme files use the normal OS theme.
    if (currentTheme === "system") {
      clearOmarchyTheme();
      delete document.documentElement.dataset.theme;
    }
  } finally {
    readingOmarchy = false;
  }
};

/** Each webview owns one poller. Hidden windows refresh when shown again. */
export const startOmarchyThemeSync = (): void => {
  if (platform() !== "linux") return;
  const refresh = () => {
    if (!document.hidden) void syncOmarchyTheme();
  };
  window.setInterval(refresh, 2000);
  document.addEventListener("visibilitychange", refresh);
};

/** Apply a theme to the document root and remember it for the next launch. */
export const applyTheme = (theme: Theme): void => {
  currentTheme = theme;
  const root = document.documentElement;
  if (theme === "system") {
    if (!root.dataset.omarchy) delete root.dataset.theme;
    void syncOmarchyTheme();
  } else {
    clearOmarchyTheme();
    root.dataset.theme = theme;
  }
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // localStorage may be unavailable (e.g. private mode); the setting still
    // persists in AppSettings, so this only costs a one-frame flash on boot.
  }
};

/** Read the last-applied theme for synchronous boot-time application. */
export const getStoredTheme = (): Theme => {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (isTheme(stored)) return stored;
  } catch {
    // ignore
  }
  return "system";
};

/** Apply the persisted theme from AppSettings (the source of truth). */
export const syncThemeFromSettings = async (): Promise<void> => {
  try {
    const result = await commands.getAppSettings();
    if (result.status === "ok") {
      applyTheme(result.data.theme ?? "system");
    }
  } catch (e) {
    console.warn("Failed to sync theme from settings:", e);
  }
};
