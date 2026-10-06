// Pure CSV helpers (no I/O). Used by the appointment export.

// Spreadsheet apps evaluate cells that start with these as formulas (CSV
// injection). A leading single quote makes them plain text. Tab and CR are
// included because some apps also treat them as formula prefixes (OWASP).
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

/** Neutralises spreadsheet formulas in a text cell. */
export const neutralizeFormula = (value: string): string =>
  FORMULA_PREFIX.test(value) ? `'${value}` : value;

/**
 * One RFC 4180 cell. Strings are formula-neutralised first; numbers, booleans
 * and dates are formatted without that step (they cannot carry a formula).
 */
export const csvCell = (value: unknown): string => {
  let text: string;
  if (value === null || value === undefined) text = "";
  else if (value instanceof Date) {
    text = Number.isNaN(value.getTime()) ? "" : value.toISOString();
  } else if (typeof value === "number") {
    text = Number.isFinite(value) ? String(value) : "";
  } else if (typeof value === "boolean") text = value ? "true" : "false";
  else text = neutralizeFormula(String(value));

  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export type CsvColumn<T> = {
  header: string;
  value: (row: T) => unknown;
};

/** Header + rows, CRLF separated, trailing CRLF. */
export const toCsv = <T>(columns: CsvColumn<T>[], rows: T[]): string => {
  const lines = [columns.map((column) => csvCell(column.header)).join(",")];
  for (const row of rows) {
    lines.push(columns.map((column) => csvCell(column.value(row))).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
};
