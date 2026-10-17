const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
export const money = (n: number | null | undefined): string => (n == null ? '—' : usd.format(n));
export const pct = (n: number | null | undefined): string => (n == null ? '—' : `${Math.round(n)}%`);

export function months(n: number): string {
  if (n < 12) return `${n} mo`;
  const y = Math.floor(n / 12);
  const m = n % 12;
  return m ? `${y} yr ${m} mo` : `${y} yr`;
}
