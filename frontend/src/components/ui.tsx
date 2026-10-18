import type { ReactNode } from 'react';

export const inputCls =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30 dark:border-slate-700 dark:bg-slate-900';

export const btnPrimary =
  'inline-flex items-center justify-center rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50';

export const btnGhost =
  'inline-flex items-center justify-center rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800';

export function Card({ title, subtitle, children, accent, flash, action }: { title: string; subtitle?: string; children: ReactNode; accent?: string; flash?: boolean; action?: ReactNode }) {
  return (
    <section
      className={`animate-fade-up overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md dark:border-slate-800 dark:bg-slate-900 ${flash ? 'animate-flash' : ''}`}
    >
      <header className="flex items-center gap-2 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
        <span className={`h-2.5 w-2.5 rounded-full ${accent ?? 'bg-emerald-500'}`} />
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          {subtitle && <p className="text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>}
        </div>
        {action && <div className="ml-auto">{action}</div>}
      </header>
      <div className="space-y-4 p-4">{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2 transition hover:-translate-y-0.5 hover:shadow-sm dark:bg-slate-800/60">
      <div className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      {hint && <div className="text-xs text-slate-500 dark:text-slate-400">{hint}</div>}
    </div>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex animate-fade-up items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl dark:bg-slate-900"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  return <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{children}</p>;
}
