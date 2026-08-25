const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Absolute timestamp for tooltips, in the viewer's locale and timezone. */
export function formatAbsolute(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export interface RelativeDate {
  text: string;
  /** True when the date has passed, so the caller can highlight it. */
  past: boolean;
}

/**
 * Renders a due date the way a task list reads: near dates relative, distant
 * ones as a plain date. Returns null for an unparseable or absent value so
 * callers show a placeholder instead of "Invalid Date".
 */
export function formatDue(iso: string, now: Date = new Date()): RelativeDate | null {
  if (iso === "") return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;

  const delta = date.getTime() - now.getTime();
  const past = delta < 0;
  const magnitude = Math.abs(delta);

  if (magnitude < HOUR) {
    const minutes = Math.max(1, Math.round(magnitude / MINUTE));
    return { text: past ? `${minutes} min ago` : `in ${minutes} min`, past };
  }
  if (magnitude < DAY) {
    const hours = Math.round(magnitude / HOUR);
    return { text: past ? `${hours} h ago` : `in ${hours} h`, past };
  }
  if (magnitude < 7 * DAY) {
    const days = Math.round(magnitude / DAY);
    return {
      text: past
        ? `${days} ${days === 1 ? "day" : "days"} ago`
        : `in ${days} ${days === 1 ? "day" : "days"}`,
      past,
    };
  }

  return {
    text: date.toLocaleDateString(undefined, {
      day: "2-digit",
      month: "short",
      year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
    }),
    past,
  };
}

/** Urgency is noisy at full precision; one decimal is what `task` shows. */
export function formatUrgency(value: number): string {
  return value.toFixed(1);
}
