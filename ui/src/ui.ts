/** Shared building blocks for the views. */

/** A centred box for loading, empty and error states, so no view ever
 *  leaves the reader looking at a blank region. */
export function notice(title: string, detail?: string): HTMLElement {
  const box = document.createElement("div");
  box.className =
    "rounded-lg border border-line bg-surface px-5 py-8 text-center";

  const heading = document.createElement("p");
  heading.className = "text-sm font-medium";
  heading.textContent = title;
  box.append(heading);

  if (detail !== undefined) {
    const body = document.createElement("p");
    body.className = "mx-auto mt-1.5 max-w-md text-sm text-muted";
    body.textContent = detail;
    box.append(body);
  }
  return box;
}

/** A segmented control. Returns the buttons so the caller can mark the
 *  active option. */
export function segmented<T extends string>(
  container: HTMLElement,
  options: ReadonlyArray<{ value: T; label: string }>,
  onSelect: (value: T) => void,
  signal: AbortSignal,
): (active: T) => void {
  const group = document.createElement("div");
  group.role = "radiogroup";
  group.className = "flex gap-0.5 rounded-md bg-raised p-0.5";

  const buttons = options.map(({ value, label }) => {
    const button = document.createElement("button");
    button.type = "button";
    button.role = "radio";
    button.textContent = label;
    button.className =
      "rounded px-2.5 py-1 text-xs text-muted hover:text-fg aria-checked:bg-surface aria-checked:text-fg aria-checked:shadow-sm";
    button.addEventListener("click", () => onSelect(value), { signal });
    group.append(button);
    return button;
  });

  container.append(group);

  return (active: T) => {
    buttons.forEach((button, index) => {
      button.setAttribute(
        "aria-checked",
        String(options[index]?.value === active),
      );
    });
  };
}

/** Copies text and briefly marks the element, without stealing focus. */
export async function copyToClipboard(
  text: string,
  feedback: HTMLElement,
): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    return; // Clipboard access can be denied; failing silently is fine here.
  }
  feedback.dataset["copied"] = "true";
  window.setTimeout(() => delete feedback.dataset["copied"], 900);
}
