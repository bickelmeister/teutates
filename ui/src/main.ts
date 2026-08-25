import { startRouter } from "./router";
import { settingsView } from "./settings";
import { tasksView } from "./tasks";
import { initTheme } from "./theme";

function element<T>(id: string): T {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`missing element #${id}`);
  return found as unknown as T;
}

initTheme(element<HTMLElement>("theme-switch"));

const search = element<HTMLInputElement>("search");

startRouter(
  {
    content: element<HTMLElement>("content"),
    title: element<HTMLElement>("view-title"),
    meta: element<HTMLElement>("meta"),
    controls: element<HTMLElement>("view-controls"),
    subnav: element<HTMLElement>("subnav"),
    search,
  },
  [
    { path: "/tasks", label: "Tasks", view: tasksView },
    { path: "/settings", label: "Settings", view: settingsView },
  ],
  new Map([
    ["/tasks", element<HTMLElement>("nav-tasks")],
    ["/settings", element<HTMLElement>("nav-settings")],
  ]),
);

// Focus the filter with "/" the way a terminal user would expect.
document.addEventListener("keydown", (event) => {
  if (event.key !== "/" || event.metaKey || event.ctrlKey) return;
  if (document.activeElement instanceof HTMLInputElement) return;
  event.preventDefault();
  search.focus();
});
