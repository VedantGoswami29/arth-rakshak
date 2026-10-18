import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, type DebtInput } from '../lib/api';
import { EXPENSE_CATEGORIES } from '../lib/categories';
import { money } from '../lib/format';
import type { Debt, FinancialData, Snapshot } from '../lib/types';
import { btnGhost, btnPrimary, ErrorText, inputCls } from './ui';

/** Called after every successful save: swap in the snapshot, toast `text`, optionally offer Undo. */
export type OnSaved = (snapshot: Snapshot, text: string, undo?: () => Promise<Snapshot>) => void;

const iconBtn =
  'rounded-md p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 active:scale-90 disabled:opacity-40 dark:hover:bg-slate-800 dark:hover:text-slate-200';
const label = 'mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500';

function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, run, setError };
}

/** Empty string → NaN so it fails validation instead of silently becoming 0. */
const num = (s: string): number => (s.trim() === '' ? NaN : Number(s));

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h4>
      {children}
    </section>
  );
}

/* ── Income & dependants ──────────────────────────────────────────────── */

function BasicsSection({ fd, onSaved }: { fd: FinancialData; onSaved: OnSaved }) {
  const [income, setIncome] = useState(String(fd.monthly_income));
  const [deps, setDeps] = useState(String(fd.dependants));
  const { busy, error, run } = useAction();

  useEffect(() => {
    setIncome(String(fd.monthly_income));
    setDeps(String(fd.dependants));
  }, [fd.monthly_income, fd.dependants]);

  const inc = num(income);
  const dep = num(deps);
  const valid = Number.isFinite(inc) && inc >= 0 && Number.isInteger(dep) && dep >= 0 && dep <= 100;
  const changes: { monthly_income?: number; dependants?: number } = {};
  if (valid && inc !== fd.monthly_income) changes.monthly_income = inc;
  if (valid && dep !== fd.dependants) changes.dependants = dep;
  const dirty = Object.keys(changes).length > 0;

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!dirty) return;
    const before = { monthly_income: fd.monthly_income, dependants: fd.dependants };
    const snap = await run(() => api.profile.setBasics(changes));
    if (snap) onSaved(snap, 'Income & dependants saved', () => api.profile.setBasics(before));
  }

  return (
    <Section title="Income & household">
      <form onSubmit={save} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
        <div>
          <label className={label} htmlFor="pe-income">Monthly income ($)</label>
          <input id="pe-income" className={inputCls} type="number" inputMode="decimal" min={0} step="any" value={income} onChange={(e) => setIncome(e.target.value)} />
        </div>
        <div>
          <label className={label} htmlFor="pe-deps">Dependants</label>
          <input id="pe-deps" className={inputCls} type="number" inputMode="numeric" min={0} max={100} step={1} value={deps} onChange={(e) => setDeps(e.target.value)} />
        </div>
        <button className={btnPrimary} disabled={!dirty || busy}>{busy ? '…' : 'Save'}</button>
      </form>
      {!valid && <p className="mt-1 text-xs text-rose-600">Income must be 0 or more and dependants a whole number (0–100).</p>}
      {error && <div className="mt-2"><ErrorText>{error}</ErrorText></div>}
    </Section>
  );
}

/* ── Expenses ─────────────────────────────────────────────────────────── */

function ExpenseRow({ category, amount, onSaved }: { category: string; amount: number; onSaved: OnSaved }) {
  const [value, setValue] = useState(String(amount));
  const { busy, error, run } = useAction();
  useEffect(() => setValue(String(amount)), [amount]);

  const n = num(value);
  const valid = Number.isFinite(n) && n >= 0;

  async function commit() {
    if (!valid || n === amount) {
      setValue(String(amount)); // revert invalid / unchanged input
      return;
    }
    const snap = await run(() => api.profile.setExpense(category, n));
    if (snap) onSaved(snap, `${category} saved`, () => api.profile.setExpense(category, amount));
  }

  async function remove() {
    const snap = await run(() => api.profile.deleteExpense(category));
    if (snap) onSaved(snap, `${category} removed`, () => api.profile.setExpense(category, amount));
  }

  return (
    <li className="animate-fade-up">
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1 truncate text-sm">{category}</span>
        <div className="relative w-32 shrink-0">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">$</span>
          <input
            className={`${inputCls} pl-6 tabular-nums ${!valid ? 'border-rose-400' : ''}`}
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            value={value}
            disabled={busy}
            aria-label={`${category} per month`}
            onChange={(e) => setValue(e.target.value)}
            onBlur={() => void commit()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') setValue(String(amount));
            }}
          />
        </div>
        <button type="button" className={iconBtn} disabled={busy} onClick={() => void remove()} aria-label={`Remove ${category}`} title="Remove">✕</button>
      </div>
      {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
    </li>
  );
}

function ExpensesSection({ fd, onSaved }: { fd: FinancialData; onSaved: OnSaved }) {
  const entries = Object.entries(fd.manual_expenses);
  const free = EXPENSE_CATEGORIES.filter((c) => !(c in fd.manual_expenses));
  const freeKey = free.join(',');
  const [open, setOpen] = useState(false);
  const [cat, setCat] = useState<string>('');
  const [amt, setAmt] = useState('');
  const { busy, error, run, setError } = useAction();

  // Keep the selection valid as categories get used up.
  useEffect(() => {
    if (!free.some((c) => c === cat)) setCat(free[0] ?? '');
  }, [freeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const n = num(amt);
  const valid = cat !== '' && Number.isFinite(n) && n >= 0;

  function openForm() {
    setError(null);
    setAmt('');
    setCat(free[0] ?? '');
    setOpen(true);
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    const snap = await run(() => api.profile.setExpense(cat, n));
    if (snap) {
      setOpen(false);
      setAmt('');
      onSaved(snap, `${cat} added`, () => api.profile.deleteExpense(cat));
    }
  }

  return (
    <Section title="Monthly expenses">
      {entries.length === 0 && !open && <p className="mb-2 text-sm text-slate-500">No expenses yet.</p>}
      <ul className="space-y-2.5">
        {entries.map(([c, a]) => (
          <ExpenseRow key={c} category={c} amount={a} onSaved={onSaved} />
        ))}
      </ul>

      <div className="mt-3">
        {open ? (
          <form onSubmit={add} className="animate-fade-up space-y-4 rounded-xl border border-emerald-300 bg-emerald-50/40 p-4 dark:border-emerald-800 dark:bg-emerald-950/20">
            <div>
              <label className={label} htmlFor="ex-cat">Category</label>
              <select id="ex-cat" className={inputCls} value={cat} onChange={(e) => setCat(e.target.value)}>
                {EXPENSE_CATEGORIES.map((c) => (
                  <option key={c} value={c} disabled={c in fd.manual_expenses}>
                    {c in fd.manual_expenses ? `${c} (already added)` : c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={label} htmlFor="ex-amt">Amount per month</label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">$</span>
                <input id="ex-amt" className={`${inputCls} pl-6`} type="number" inputMode="decimal" min={0} step="any" placeholder="0" value={amt} onChange={(e) => setAmt(e.target.value)} />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" className={btnGhost} onClick={() => setOpen(false)}>Cancel</button>
              <button className={btnPrimary} disabled={!valid || busy}>{busy ? '…' : 'Add'}</button>
            </div>
          </form>
        ) : free.length > 0 ? (
          <button type="button" className={`${btnGhost} w-full border-dashed`} onClick={openForm}>
            ＋ Add an expense
          </button>
        ) : (
          <p className="text-xs text-slate-500">All categories are in use — edit an amount above.</p>
        )}
      </div>
      {error && <div className="mt-2"><ErrorText>{error}</ErrorText></div>}
    </Section>
  );
}

/* ── Debts ────────────────────────────────────────────────────────────── */

function DebtForm({ initial, submitLabel, onSubmit, onCancel }: { initial?: Debt; submitLabel: string; onSubmit: (d: DebtInput) => Promise<boolean>; onCancel: () => void }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [amount, setAmount] = useState(initial ? String(initial.amount) : '');
  const [rate, setRate] = useState(initial ? String(initial.interest_rate) : '');
  const [min, setMin] = useState(initial?.min_payment != null ? String(initial.min_payment) : '');
  const [busy, setBusy] = useState(false);

  const a = num(amount);
  const r = num(rate);
  const m = min.trim() === '' ? null : num(min);
  const valid = name.trim() !== '' && Number.isFinite(a) && a >= 0 && Number.isFinite(r) && r >= 0 && r <= 1000 && (m === null || (Number.isFinite(m) && m >= 0));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    const done = await onSubmit({ name: name.trim(), amount: a, interest_rate: r, min_payment: m });
    setBusy(false);
    if (done) onCancel();
  }

  return (
    <form onSubmit={submit} className="animate-fade-up space-y-2 rounded-xl border border-emerald-300 bg-emerald-50/40 p-3 dark:border-emerald-800 dark:bg-emerald-950/20">
      <div>
        <label className={label} htmlFor="d-name">Name</label>
        <input id="d-name" className={inputCls} value={name} maxLength={100} placeholder="e.g. Car loan" onChange={(e) => setName(e.target.value)} autoFocus />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className={label} htmlFor="d-amount">Balance ($)</label>
          <input id="d-amount" className={inputCls} type="number" inputMode="decimal" min={0} step="any" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div>
          <label className={label} htmlFor="d-rate">APR (%)</label>
          <input id="d-rate" className={inputCls} type="number" inputMode="decimal" min={0} max={1000} step="any" value={rate} onChange={(e) => setRate(e.target.value)} />
        </div>
        <div>
          <label className={label} htmlFor="d-min">Min. payment</label>
          <input id="d-min" className={inputCls} type="number" inputMode="decimal" min={0} step="any" placeholder="optional" value={min} onChange={(e) => setMin(e.target.value)} />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" className={btnGhost} onClick={onCancel}>Cancel</button>
        <button className={btnPrimary} disabled={!valid || busy}>{busy ? '…' : submitLabel}</button>
      </div>
    </form>
  );
}

const toInput = (d: Debt): DebtInput => ({ name: d.name, amount: d.amount, interest_rate: d.interest_rate, min_payment: d.min_payment });

function DebtsSection({ fd, onSaved }: { fd: FinancialData; onSaved: OnSaved }) {
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const { busy, error, run, setError } = useAction();

  async function create(d: DebtInput): Promise<boolean> {
    const snap = await run(() => api.profile.createDebt(d));
    if (snap) onSaved(snap, `${d.name} added`, () => api.profile.deleteDebt(d.name));
    return !!snap;
  }

  async function update(old: Debt, d: DebtInput): Promise<boolean> {
    const snap = await run(() => api.profile.updateDebt(old.name, d));
    if (snap) onSaved(snap, `${d.name} saved`, () => api.profile.updateDebt(d.name, toInput(old)));
    return !!snap;
  }

  async function remove(d: Debt) {
    const snap = await run(() => api.profile.deleteDebt(d.name));
    if (snap) onSaved(snap, `${d.name} removed`, () => api.profile.createDebt(toInput(d)));
  }

  return (
    <Section title="Debts">
      {fd.debts.length === 0 && editing !== 'new' && <p className="mb-2 text-sm text-slate-500">No debts recorded.</p>}
      <ul className="space-y-2">
        {fd.debts.map((d) => (
          <li key={d.name} className="animate-fade-up">
            {editing === d.name ? (
              <DebtForm initial={d} submitLabel="Save" onSubmit={(x) => update(d, x)} onCancel={() => setEditing(null)} />
            ) : (
              <div className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm dark:border-slate-700">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{d.name}</div>
                  <div className="text-xs text-slate-500">
                    {money(d.amount)} @ {d.interest_rate}%{d.min_payment != null ? ` · min ${money(d.min_payment)}` : ''}
                  </div>
                </div>
                <button type="button" className={iconBtn} disabled={busy} onClick={() => { setError(null); setEditing(d.name); }} aria-label={`Edit ${d.name}`} title="Edit">✎</button>
                <button type="button" className={iconBtn} disabled={busy} onClick={() => void remove(d)} aria-label={`Remove ${d.name}`} title="Remove">✕</button>
              </div>
            )}
          </li>
        ))}
      </ul>

      <div className="mt-3">
        {editing === 'new' ? (
          <DebtForm submitLabel="Add debt" onSubmit={create} onCancel={() => setEditing(null)} />
        ) : (
          <button type="button" className={`${btnGhost} w-full border-dashed`} onClick={() => { setError(null); setEditing('new'); }}>
            ＋ Add a debt
          </button>
        )}
      </div>
      {error && <div className="mt-2"><ErrorText>{error}</ErrorText></div>}
    </Section>
  );
}

/* ── Editor ───────────────────────────────────────────────────────────── */

export default function ProfileEditor({ fd, onSaved }: { fd: FinancialData; onSaved: OnSaved }) {
  return (
    <div className="space-y-5">
      <BasicsSection fd={fd} onSaved={onSaved} />
      <ExpensesSection fd={fd} onSaved={onSaved} />
      <DebtsSection fd={fd} onSaved={onSaved} />
    </div>
  );
}
