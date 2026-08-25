const STORAGE_KEY = "teutates.theme";

export type ThemeChoice = "light" | "dark" | "system";

const CHOICES: readonly ThemeChoice[] = ["light", "dark", "system"];

const LABELS: Record<ThemeChoice, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

function read(): ThemeChoice {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null && (CHOICES as readonly string[]).includes(stored)) {
      return stored as ThemeChoice;
    }
  } catch {
    // Storage can be unavailable in private browsing; fall through.
  }
  return "system";
}

function store(choice: ThemeChoice): void {
  try {
    localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    // Not persisting is acceptable; the current page still switches.
  }
}

function apply(choice: ThemeChoice): void {
  const dark =
    choice === "dark" ||
    (choice === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

/**
 * Renders the three-way theme switch and keeps the document in sync with
 * the OS setting while "system" is selected.
 */
export function initTheme(container: HTMLElement): void {
  let current = read();
  apply(current);

  const buttons = CHOICES.map((choice) => {
    const button = document.createElement("button");
    button.type = "button";
    button.role = "radio";
    button.textContent = LABELS[choice];
    button.className =
      "flex-1 rounded px-2 py-1 text-xs text-muted hover:text-fg aria-checked:bg-surface aria-checked:text-fg aria-checked:shadow-sm";
    button.addEventListener("click", () => {
      current = choice;
      store(choice);
      apply(choice);
      sync();
    });
    container.append(button);
    return button;
  });

  function sync(): void {
    buttons.forEach((button, index) => {
      button.setAttribute("aria-checked", String(CHOICES[index] === current));
    });
  }

  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", () => {
      if (current === "system") apply(current);
    });

  sync();
}
