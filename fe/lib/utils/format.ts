export function formatCurrency(
  amount: number,
  currency: string = "USD",
  locale: string = "en-US"
): string {
  if (!Number.isFinite(amount)) {
    return "—";
  }

  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
  }).format(amount);
}


