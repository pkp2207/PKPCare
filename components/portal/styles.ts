// Shared class strings for portal buttons.
//
// The repo's `.shad-primary-btn` is white text on #24AE7C (about 2.8:1, below the
// WCAG AA 4.5:1 for normal text) and `.shad-danger-btn` is white on #F24E43
// (about 3.5:1). These use the dark palette colour for text instead (about 6.9:1
// and 5.5:1). Each colour utility is repeated with the `dark:` prefix because
// the shadcn Button variant sets `dark:bg-slate-50` which would otherwise win in
// the dark theme (the app's default).

export const BTN_PRIMARY =
  "bg-green-500 text-dark-200 font-semibold hover:bg-green-500/90 dark:bg-green-500 dark:text-dark-200 dark:hover:bg-green-500/90";

export const BTN_DANGER =
  "bg-red-700 text-dark-200 font-semibold hover:bg-red-700/90 dark:bg-red-700 dark:text-dark-200 dark:hover:bg-red-700/90";

export const BTN_SECONDARY =
  "border border-dark-500 bg-dark-400 text-white hover:bg-dark-500 dark:border-dark-500 dark:bg-dark-400 dark:text-white dark:hover:bg-dark-500";

export const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-dark-300";
