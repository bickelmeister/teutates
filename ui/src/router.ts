import type { View, ViewContext } from "./view";

type Shell = Omit<ViewContext, "signal">;

interface Route {
  path: string;
  label: string;
  view: () => View;
}

/**
 * Minimal hash router. Each navigation aborts the previous view's signal,
 * so listeners a view registered are removed without it having to track
 * them, and clears the shared chrome to a known-empty state.
 */
export function startRouter(
  shell: Shell,
  routes: Route[],
  navLinks: Map<string, HTMLElement>,
): void {
  let active: AbortController | undefined;

  function resolve(): Route {
    const path = window.location.hash.replace(/^#/, "");
    return routes.find((route) => route.path === path) ?? (routes[0] as Route);
  }

  async function navigate(): Promise<void> {
    const route = resolve();

    active?.abort();
    active = new AbortController();

    shell.content.replaceChildren();
    shell.controls.replaceChildren();
    shell.subnav.replaceChildren();
    shell.meta.textContent = "";
    shell.search.value = "";

    for (const [path, link] of navLinks) {
      const current = path === route.path;
      link.classList.toggle("bg-raised", current);
      link.classList.toggle("font-medium", current);
      link.classList.toggle("text-muted", !current);
      if (current) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }

    const view = route.view();
    shell.title.textContent = view.title;
    shell.search.placeholder = view.searchPlaceholder;
    document.title = `${view.title} · teutates`;

    await view.mount({ ...shell, signal: active.signal });
  }

  window.addEventListener("hashchange", () => void navigate());

  // A bare "/" or an unknown fragment lands on the first route; normalise the
  // address bar so a reload returns to the same place.
  if (!routes.some((route) => route.path === window.location.hash.slice(1))) {
    window.location.hash = routes[0]?.path ?? "";
  }
  void navigate();
}
