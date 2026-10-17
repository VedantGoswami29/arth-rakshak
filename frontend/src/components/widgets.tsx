import { useEffect, useRef, useState, type ReactNode } from 'react';
import { money } from '../lib/format';
import { applyTheme, getInitialTheme, type Theme } from '../lib/theme';

/* ── hooks ────────────────────────────────────────────────────────────── */

export function useReducedMotion(): boolean {
  const [reduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  return reduced;
}

/** false on first paint, true one frame later — lets CSS transitions animate from the empty state. */
export function useMounted(): boolean {
  const [m, setM] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setM(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return m;
}

/* ── animated number ──────────────────────────────────────────────────── */

export function AnimatedNumber({
  value,
  format = money,
  duration = 800,
}: {
  value: number;
  format?: (n: number) => string;
  duration?: number;
}) {
  const reduced = useReducedMotion();
  const [display, setDisplay] = useState(reduced ? value : 0);
  const from = useRef(reduced ? value : 0);

  useEffect(() => {
    if (reduced) {
      setDisplay(value);
      from.current = value;
      return;
    }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const v = a + (value - a) * (1 - Math.pow(1 - t, 3));
      from.current = v;
      setDisplay(v);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration, reduced]);

  return <span className="tabular-nums">{format(display)}</span>;
}

/* ── bar ──────────────────────────────────────────────────────────────── */

export function Bar({ percent, color = 'bg-emerald-500', height = 'h-2' }: { percent: number; color?: string; height?: string }) {
  const mounted = useMounted();
  const w = Math.max(0, Math.min(100, percent));
  return (
    <div className={`${height} overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800`}>
      <div className={`h-full rounded-full ${color} transition-[width] duration-700 ease-out`} style={{ width: mounted ? `${w}%` : '0%' }} />
    </div>
  );
}

/* ── donut chart (hover / focus / click-to-pin) ───────────────────────── */

const PALETTE = ['#10b981', '#0ea5e9', '#8b5cf6', '#f59e0b', '#f43f5e', '#14b8a6', '#6366f1', '#f97316', '#84cc16', '#ec4899'];
export const colorAt = (i: number): string => PALETTE[i % PALETTE.length] ?? '#10b981';

export interface DonutItem {
  label: string;
  value: number;
}

export function Donut({ items, centerLabel = 'Total' }: { items: DonutItem[]; centerLabel?: string }) {
  const mounted = useMounted();
  const [hover, setHover] = useState<number | null>(null);
  const [pinned, setPinned] = useState<number | null>(null);
  const active = hover ?? pinned;

  const total = items.reduce((s, i) => s + i.value, 0);
  const safeTotal = total || 1;
  let acc = 0;
  const segs = items.map((it, i) => {
    const p = (it.value / safeTotal) * 100;
    const seg = { it, i, p, start: acc };
    acc += p;
    return seg;
  });
  const R = 15.9155;
  const activeItem = active !== null ? items[active] : undefined;

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row">
      <div className="relative h-40 w-40 shrink-0">
        <svg viewBox="0 0 42 42" className="h-full w-full -rotate-90" role="img" aria-label={`Spending breakdown, total ${money(total)}`}>
          <circle cx="21" cy="21" r={R} fill="none" strokeWidth="5" className="stroke-slate-100 dark:stroke-slate-800" />
          {segs.map(({ it, i, p, start }) => {
            const len = mounted ? Math.max(p - 0.6, 0) : 0;
            return (
              <circle
                key={it.label}
                cx="21"
                cy="21"
                r={R}
                fill="none"
                stroke={colorAt(i)}
                strokeWidth={active === i ? 6.5 : 5}
                strokeDasharray={`${len} ${100 - len}`}
                strokeDashoffset={-start}
                opacity={active === null || active === i ? 1 : 0.3}
                className="cursor-pointer transition-all duration-700 ease-out"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onClick={() => setPinned((v) => (v === i ? null : i))}
              />
            );
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="max-w-[6rem] truncate text-[11px] uppercase tracking-wide text-slate-500">{activeItem ? activeItem.label : centerLabel}</span>
          <span className="text-lg font-semibold">
            <AnimatedNumber value={activeItem ? activeItem.value : total} duration={450} />
          </span>
          {activeItem && <span className="text-xs text-slate-500">{Math.round((activeItem.value / safeTotal) * 100)}%</span>}
        </div>
      </div>

      <ul className="grid w-full gap-1 text-sm">
        {items.map((it, i) => (
          <li key={it.label}>
            <button
              type="button"
              aria-pressed={pinned === i}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              onClick={() => setPinned((v) => (v === i ? null : i))}
              className={`flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left transition hover:bg-slate-100 dark:hover:bg-slate-800 ${pinned === i ? 'bg-slate-100 dark:bg-slate-800' : ''}`}
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colorAt(i) }} />
              <span className="flex-1 truncate">{it.label}</span>
              <span className="tabular-nums text-slate-600 dark:text-slate-300">{money(it.value)}</span>
              <span className="w-9 text-right text-xs tabular-nums text-slate-400">{Math.round((it.value / safeTotal) * 100)}%</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ── progress ring ────────────────────────────────────────────────────── */

export function Ring({ percent, color = '#8b5cf6', size = 92, children }: { percent: number; color?: string; size?: number; children?: ReactNode }) {
  const mounted = useMounted();
  const p = Math.max(0, Math.min(100, percent));
  const R = 15.9155;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 42 42" className="h-full w-full -rotate-90" role="img" aria-label={`${Math.round(p)} percent`}>
        <circle cx="21" cy="21" r={R} fill="none" strokeWidth="4.5" className="stroke-slate-100 dark:stroke-slate-800" />
        <circle
          cx="21"
          cy="21"
          r={R}
          fill="none"
          stroke={color}
          strokeWidth="4.5"
          strokeLinecap="round"
          strokeDasharray={`${mounted ? p : 0} ${100 - (mounted ? p : 0)}`}
          className="transition-all duration-1000 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-sm font-semibold">{children}</div>
    </div>
  );
}

/* ── collapsible section ──────────────────────────────────────────────── */

export function Collapsible({ title, badge, defaultOpen = false, children }: { title: string; badge?: string | number; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded-lg py-1 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
      >
        <svg viewBox="0 0 20 20" className={`h-4 w-4 transition-transform duration-300 ${open ? 'rotate-90' : ''}`} fill="currentColor" aria-hidden>
          <path d="M7 5l6 5-6 5V5z" />
        </svg>
        {title}
        {badge != null && <span className="rounded-full bg-slate-200 px-1.5 text-[10px] text-slate-600 dark:bg-slate-700 dark:text-slate-300">{badge}</span>}
      </button>
      <div className={`grid transition-[grid-template-rows] duration-300 ease-out ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
        <div className="overflow-hidden">
          <div className="pt-2">{children}</div>
        </div>
      </div>
    </div>
  );
}

/* ── theme toggle ─────────────────────────────────────────────────────── */

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  return (
    <button
      type="button"
      aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
      onClick={() => {
        const next: Theme = theme === 'dark' ? 'light' : 'dark';
        applyTheme(next);
        setTheme(next);
      }}
      className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-300 text-base transition hover:bg-slate-100 active:scale-90 dark:border-slate-700 dark:hover:bg-slate-800"
    >
      <span key={theme} className="animate-fade-up">{theme === 'dark' ? '🌙' : '☀️'}</span>
    </button>
  );
}
