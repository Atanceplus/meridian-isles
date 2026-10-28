/** Sand is the default theme; dark is an opt-in remembered per browser. */
export type Theme = "sand" | "dark";

const KEY = "meridian.theme";

export function getTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === "dark" ? "dark" : "sand";
  } catch {
    return "sand";
  }
}

export function applyTheme(theme: Theme): void {
  if (theme === "dark") document.documentElement.dataset.theme = "dark";
  else delete document.documentElement.dataset.theme;
}

export function setTheme(theme: Theme): void {
  applyTheme(theme);
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // Without storage the choice just lasts for this visit.
  }
}
