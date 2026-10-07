// Shared Tailwind class strings for the admin console. Colours come from the
// existing palette (dark-*, green-500, red-500, light-200); text on green/red
// buttons is black because white on #24AE7C fails WCAG AA contrast.

const focus =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-500";

const btn = `inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-md px-4 text-sm font-semibold transition-colors ${focus} disabled:pointer-events-none disabled:opacity-50`;

export const ui = {
  focus,
  card: "rounded-2xl border border-dark-500 bg-dark-400 p-5 shadow-lg",
  input: `h-11 w-full rounded-md border border-dark-500 bg-dark-300 px-3 text-sm text-white placeholder:text-dark-600 ${focus} disabled:opacity-50`,
  textarea: `min-h-[88px] w-full rounded-md border border-dark-500 bg-dark-300 p-3 text-sm text-white placeholder:text-dark-600 ${focus}`,
  label: "text-14-medium text-dark-700",
  hint: "text-12-regular text-dark-700",
  btn,
  btnPrimary: `${btn} bg-green-500 text-black hover:bg-green-500/90`,
  btnSecondary: `${btn} border border-dark-500 bg-dark-300 text-light-200 hover:bg-dark-500/60`,
  btnDanger: `${btn} bg-red-500 text-black hover:bg-red-500/90`,
  btnGhost: `${btn} text-light-200 hover:bg-dark-500/60`,
  btnSm: "h-9 px-3",
  error: "text-14-regular text-red-400",
  dialog: "shad-dialog text-light-200 max-h-[90vh] overflow-y-auto",
  tableWrap:
    "w-full overflow-x-auto rounded-lg border border-dark-400 shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-green-500",
  th: "px-4 py-3 text-left text-12-semibold uppercase tracking-wide text-dark-700",
  td: "px-4 py-3 align-middle text-14-regular text-light-200",
} as const;
