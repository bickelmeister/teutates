import { initSettings } from "./settings";
import { initTheme } from "./theme";

function require<T extends Element>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`missing element #${id}`);
  return element as unknown as T;
}

initTheme(require<HTMLElement>("theme-switch"));

void initSettings({
  content: require<HTMLElement>("content"),
  groupNav: require<HTMLElement>("group-nav"),
  meta: require<HTMLElement>("meta"),
  search: require<HTMLInputElement>("search"),
  onlyChanged: require<HTMLInputElement>("only-changed"),
});

// Focus the filter with "/" the way a terminal user would expect.
document.addEventListener("keydown", (event) => {
  if (event.key !== "/" || event.metaKey || event.ctrlKey) return;
  const active = document.activeElement;
  if (active instanceof HTMLInputElement) return;
  event.preventDefault();
  require<HTMLInputElement>("search").focus();
});
