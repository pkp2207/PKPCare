/** "USD 12.50" style amount from minor units, honouring the currency's decimals. */
export const formatMinorAmount = (amountMinor: number, currency: string): string => {
  const code = (currency || "").toUpperCase();
  try {
    const formatter = new Intl.NumberFormat("en-US", { style: "currency", currency: code });
    const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
    return formatter.format(amountMinor / 10 ** digits);
  } catch {
    return `${(amountMinor / 100).toFixed(2)} ${code}`.trim();
  }
};
