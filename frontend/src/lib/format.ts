const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
export const money = (n: number | null | undefined): string => (n == null ? '—' : inr.format(n));
export const pct = (n: number | null | undefined): string => (n == null ? '—' : `${Math.round(n)}%`);

export function months(n: number): string {
  if (n < 12) return `${n} mo`;
  const y = Math.floor(n / 12);
  const m = n % 12;
  return m ? `${y} yr ${m} mo` : `${y} yr`;
}
