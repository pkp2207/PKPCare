import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

// Console noise that is not an application error.
const IGNORED_CONSOLE = [
  /Failed to load resource.*(sentry|ingest)/i,
  /ingest\.(us\.)?sentry\.io/i,
  /Download the React DevTools/i,
  /\[Intervention\]/i,
];

/** Collects console errors and uncaught page errors for the lifetime of the page. */
export const watchErrors = (page: Page) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (IGNORED_CONSOLE.some((pattern) => pattern.test(text))) return;
    errors.push(`console: ${text}`);
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  return errors;
};

/**
 * Catches the "unstyled page" class of bug (stylesheet missing, Tailwind not applied):
 * stylesheets loaded with real rules, a non-serif body font, `sr-only` content hidden.
 */
export const expectStyled = async (page: Page) => {
  const result = await page.evaluate(() => {
    const rules = Array.from(document.styleSheets).reduce((sum, sheet) => {
      try {
        return sum + sheet.cssRules.length;
      } catch {
        return sum;
      }
    }, 0);
    const srOnly = Array.from(document.querySelectorAll<HTMLElement>(".sr-only")).filter(
      (element) => {
        const box = element.getBoundingClientRect();
        return box.width > 2 || box.height > 2;
      }
    ).length;
    return {
      rules,
      font: getComputedStyle(document.body).fontFamily,
      srOnlyVisible: srOnly,
    };
  });
  expect(result.rules, "stylesheet rules loaded").toBeGreaterThan(200);
  expect(result.font.toLowerCase(), "body font family").not.toMatch(/^(times|"times new roman"|serif)/);
  expect(result.srOnlyVisible, "sr-only elements must be visually hidden").toBe(0);
};

export type AxeOptions = {
  /** Rule ids to skip, each with a documented reason at the call site. */
  disable?: string[];
  /** Restrict the scan to a selector (e.g. inside a dialog). */
  include?: string;
};

/** Fails on serious or critical WCAG 2.x A/AA violations. */
export const expectNoSeriousA11yViolations = async (page: Page, options: AxeOptions = {}) => {
  let builder = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]);
  if (options.disable?.length) builder = builder.disableRules(options.disable);
  if (options.include) builder = builder.include(options.include);
  const { violations } = await builder.analyze();
  const serious = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  const summary = serious
    .map(
      (v) =>
        `${v.id} (${v.impact}): ${v.help}\n   ` +
        v.nodes
          .slice(0, 3)
          .map((n) => n.target.join(" "))
          .join("\n   ")
    )
    .join("\n");
  expect(serious, `axe violations on ${page.url()}:\n${summary}`).toEqual([]);
};
