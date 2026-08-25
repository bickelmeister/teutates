/** The chrome a view renders into. The shell owns these elements; a view
 *  fills them on mount and the router clears them again on leave. */
export interface ViewContext {
  /** Main region below the header. */
  content: HTMLElement;
  /** Page heading. */
  title: HTMLElement;
  /** Small line under the heading for counts and provenance. */
  meta: HTMLElement;
  /** Shared filter field. The router resets its value between views. */
  search: HTMLInputElement;
  /** Slot for view-specific controls next to the filter field. */
  controls: HTMLElement;
  /** Sidebar area below the active nav entry. */
  subnav: HTMLElement;
  /** Aborted when the view is left; use it for every listener. */
  signal: AbortSignal;
}

export interface View {
  /** Shown in the header and the document title. */
  title: string;
  /** Placeholder for the shared filter field. */
  searchPlaceholder: string;
  mount(context: ViewContext): Promise<void>;
}
