import { useMemo, useState } from 'react';
import { money, months } from '../lib/format';
import { assumedMin, simulatePayoff } from '../lib/payoff';
import type { BudgetAnalysis, DebtReduction, FinancialData, PayoffPlan, SavingsStrategy, Snapshot } from '../lib/types';
import { Card, Stat } from './ui';
import { AnimatedNumber, Bar, Collapsible, Donut, Ring, colorAt } from './widgets';

function Empty({ children }: { children: string }) {
  return <p className="text-sm text-slate-500 dark:text-slate-400">{children}</p>;
}

const tipCls = 'rounded-lg bg-slate-50 p-3 text-sm transition hover:bg-slate-100 dark:bg-slate-800/60 dark:hover:bg-slate-800';

/* ── Profile ──────────────────────────────────────────────────────────── */

function CashFlow({ income, spend }: { income: number; spend: number }) {
  const left = income - spend;
  const over = left < 0;
  const spendPct = income > 0 ? Math.min(100, (spend / income) * 100) : spend > 0 ? 100 : 0;
  const rate = income > 0 ? (left / income) * 100 : 0;
  return (
    <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
      <div className="mb-2 flex items-baseline justify-between text-sm">
        <span className="font-medium">{over ? 'Over budget by' : 'Left over each month'}</span>
        <span className={`text-base font-semibold ${over ? 'text-rose-600' : 'text-emerald-600'}`}>
          <AnimatedNumber value={Math.abs(left)} />
        </span>
      </div>
      <Bar percent={spendPct} color={over ? 'bg-rose-500' : spendPct > 85 ? 'bg-amber-500' : 'bg-emerald-500'} height="h-3" />
      <div className="mt-1.5 flex justify-between text-xs text-slate-500">
        <span>Spending {Math.round(spendPct)}% of income</span>
        {income > 0 && <span>{over ? '' : `Savings rate ${Math.round(rate)}%`}</span>}
      </div>
    </div>
  );
}

function ProfileCard({ fd, flash }: { fd: FinancialData; flash: boolean }) {
  const expenses = Object.entries(fd.manual_expenses).sort((a, b) => b[1] - a[1]);
  const total = expenses.reduce((s, [, v]) => s + v, 0);
  const empty = fd.monthly_income === 0 && fd.dependants === 0 && expenses.length === 0 && fd.debts.length === 0;
  const max = Math.max(...expenses.map(([, v]) => v), 1);

  return (
    <Card title="Your profile" subtitle="Kept up to date from your chat" accent="bg-sky-500" flash={flash}>
      {empty ? (
        <Empty>Nothing yet. Tell the coach your income, expenses and debts in the chat.</Empty>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Income / mo" value={<AnimatedNumber value={fd.monthly_income} />} />
            <Stat label="Expenses / mo" value={<AnimatedNumber value={total} />} />
            <Stat label="Dependants" value={<AnimatedNumber value={fd.dependants} format={(n) => String(Math.round(n))} />} />
          </div>

          {(fd.monthly_income > 0 || total > 0) && <CashFlow income={fd.monthly_income} spend={total} />}

          {expenses.length > 0 && (
            <Collapsible title="Expenses" badge={expenses.length} defaultOpen>
              <ul className="space-y-2 text-sm">
                {expenses.map(([k, v]) => (
                  <li key={k}>
                    <div className="mb-1 flex justify-between">
                      <span>{k}</span>
                      <span className="tabular-nums">{money(v)}</span>
                    </div>
                    <Bar percent={(v / max) * 100} height="h-1.5" color="bg-sky-500" />
                  </li>
                ))}
              </ul>
            </Collapsible>
          )}

          {fd.debts.length > 0 && (
            <Collapsible title="Debts" badge={fd.debts.length} defaultOpen>
              <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
                {fd.debts.map((d, i) => (
                  <li key={`${d.name}-${i}`} className="flex items-center justify-between py-1.5">
                    <span>
                      {d.name} <span className="text-xs text-slate-500">@ {d.interest_rate}%</span>
                    </span>
                    <span className="tabular-nums">{money(d.amount)}</span>
                  </li>
                ))}
              </ul>
            </Collapsible>
          )}
        </>
      )}
    </Card>
  );
}

/* ── Budget ───────────────────────────────────────────────────────────── */

function BudgetCard({ r, flash }: { r: BudgetAnalysis; flash: boolean }) {
  const savings = r.recommendations.reduce((s, x) => s + (x.potential_savings ?? 0), 0);
  const items = [...r.spending_categories].sort((a, b) => b.amount - a.amount).map((c) => ({ label: c.category, value: c.amount }));

  return (
    <Card title="Budget analysis" subtitle="Tap a slice or a row to focus it" accent="bg-emerald-500" flash={flash}>
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Expenses" value={<AnimatedNumber value={r.total_expenses} />} />
        <Stat label="Income" value={r.monthly_income != null ? <AnimatedNumber value={r.monthly_income} /> : '—'} />
        <Stat label="Possible savings" value={<AnimatedNumber value={savings} />} hint="per month" />
      </div>

      <Donut items={items} centerLabel="Spending" />

      <Collapsible title="Recommendations" badge={r.recommendations.length} defaultOpen>
        <ul className="space-y-2">
          {r.recommendations.map((x, i) => (
            <li key={i} className={tipCls}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium">{x.category}</span>
                {x.potential_savings != null && (
                  <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                    save {money(x.potential_savings)}/mo
                  </span>
                )}
              </div>
              <p className="mt-1 text-slate-600 dark:text-slate-300">{x.recommendation}</p>
            </li>
          ))}
        </ul>
      </Collapsible>
    </Card>
  );
}

/* ── Savings ──────────────────────────────────────────────────────────── */

function SavingsCard({ r, flash }: { r: SavingsStrategy; flash: boolean }) {
  const ef = r.emergency_fund;
  const progress = ef.current_amount != null && ef.recommended_amount > 0 ? Math.min(100, (ef.current_amount / ef.recommended_amount) * 100) : 0;
  const total = r.recommendations.reduce((s, x) => s + x.amount, 0);
  const max = Math.max(...r.recommendations.map((x) => x.amount), 1);

  return (
    <Card title="Savings strategy" accent="bg-violet-500" flash={flash}>
      <div className="flex items-center gap-4">
        <Ring percent={progress}>
          <AnimatedNumber value={progress} format={(n) => `${Math.round(n)}%`} />
        </Ring>
        <div className="min-w-0 text-sm">
          <div className="font-medium">Emergency fund</div>
          <div className="tabular-nums text-slate-600 dark:text-slate-300">
            {money(ef.current_amount ?? 0)} of {money(ef.recommended_amount)}
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{ef.current_status}</p>
        </div>
      </div>

      <Stat label="Suggested saving" value={<AnimatedNumber value={total} />} hint="per month, all categories" />

      <ul className="space-y-2">
        {r.recommendations.map((x, i) => (
          <li key={i} className={tipCls}>
            <div className="flex justify-between gap-2">
              <span className="flex items-center gap-2 font-medium">
                <span className="h-2 w-2 rounded-full" style={{ background: colorAt(i) }} />
                {x.category}
              </span>
              <span className="font-medium tabular-nums">{money(x.amount)}/mo</span>
            </div>
            <div className="mt-2">
              <Bar percent={(x.amount / max) * 100} height="h-1.5" color="bg-violet-500" />
            </div>
            {x.rationale && <p className="mt-2 text-slate-600 dark:text-slate-300">{x.rationale}</p>}
          </li>
        ))}
      </ul>

      {r.automation_techniques && r.automation_techniques.length > 0 && (
        <Collapsible title="Automate it" badge={r.automation_techniques.length}>
          <ul className="space-y-1.5 text-sm">
            {r.automation_techniques.map((t, i) => (
              <li key={i}>
                <span className="font-medium">{t.name}:</span> <span className="text-slate-600 dark:text-slate-300">{t.description}</span>
              </li>
            ))}
          </ul>
        </Collapsible>
      )}
    </Card>
  );
}

/* ── Debt ─────────────────────────────────────────────────────────────── */

function PlanBox({ title, hint, plan, best, maxMonths, maxInterest }: { title: string; hint: string; plan: PayoffPlan; best: boolean; maxMonths: number; maxInterest: number }) {
  return (
    <div className={`rounded-xl border p-3 transition ${best ? 'border-emerald-400 bg-emerald-50/60 dark:border-emerald-700 dark:bg-emerald-950/30' : 'border-slate-200 dark:border-slate-700'}`}>
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">{title}</div>
        {best && <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-semibold text-white">LOWEST INTEREST</span>}
      </div>
      <div className="mb-3 text-xs text-slate-500">{hint}</div>
      <div className="space-y-2 text-sm">
        <div>
          <div className="mb-1 flex justify-between"><span className="text-slate-500">Debt-free in</span><span className="font-medium tabular-nums">{months(plan.months_to_payoff)}</span></div>
          <Bar percent={(plan.months_to_payoff / maxMonths) * 100} height="h-1.5" color="bg-sky-500" />
        </div>
        <div>
          <div className="mb-1 flex justify-between"><span className="text-slate-500">Total interest</span><span className="font-medium tabular-nums">{money(plan.total_interest)}</span></div>
          <Bar percent={(plan.total_interest / maxInterest) * 100} height="h-1.5" color="bg-rose-500" />
        </div>
        <div className="flex justify-between"><span className="text-slate-500">Monthly payment</span><span className="font-medium tabular-nums">{money(plan.monthly_payment)}</span></div>
      </div>
    </div>
  );
}

/** Interactive "what if I pay extra?" estimate, computed in the browser from the report's debts. */
function PayoffSimulator({ debts }: { debts: DebtReduction['debts'] }) {
  const [extra, setExtra] = useState(100);
  const base = useMemo(() => simulatePayoff(debts, 0), [debts]);
  const boosted = useMemo(() => simulatePayoff(debts, extra), [debts, extra]);
  const usedAssumption = debts.some((d) => d.min_payment == null || d.min_payment <= 0);
  const monthsSaved = base.never ? null : base.months - boosted.months;
  const interestSaved = base.never ? null : base.interest - boosted.interest;

  return (
    <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
      <div className="mb-1 flex items-center justify-between">
        <h4 className="text-sm font-semibold">What if I pay extra?</h4>
        <span className="text-sm font-semibold text-emerald-600">+{money(extra)}/mo</span>
      </div>
      <input
        type="range"
        min={0}
        max={1000}
        step={25}
        value={extra}
        onChange={(e) => setExtra(Number(e.target.value))}
        aria-label="Extra monthly payment"
        className="w-full accent-emerald-600"
      />
      <div className="mt-2 grid grid-cols-3 gap-2 text-center">
        <Stat label="Debt-free in" value={boosted.never ? '50+ yr' : <AnimatedNumber value={boosted.months} format={(n) => months(Math.round(n))} />} />
        <Stat label="Time saved" value={monthsSaved == null ? '—' : <AnimatedNumber value={monthsSaved} format={(n) => months(Math.round(n))} />} />
        <Stat label="Interest saved" value={interestSaved == null ? '—' : <AnimatedNumber value={interestSaved} />} />
      </div>
      <p className="mt-2 text-[11px] leading-snug text-slate-500">
        Estimate (highest-rate debt first, freed-up payments roll over).{' '}
        {usedAssumption && `Where no minimum payment is known it assumes the greater of $25 or 2% of the balance (${debts.filter((d) => d.min_payment == null || d.min_payment <= 0).map((d) => `${d.name}: ${money(assumedMin(d))}`).join(', ')}). `}
        The plans above come from your coach.
      </p>
    </div>
  );
}

function DebtCard({ r, flash }: { r: DebtReduction; flash: boolean }) {
  const { avalanche, snowball } = r.payoff_plans;
  const maxMonths = Math.max(avalanche.months_to_payoff, snowball.months_to_payoff, 1);
  const maxInterest = Math.max(avalanche.total_interest, snowball.total_interest, 1);
  const avalancheBest = avalanche.total_interest <= snowball.total_interest;
  const maxDebt = Math.max(...r.debts.map((d) => d.amount), 1);

  return (
    <Card title="Debt payoff plan" accent="bg-rose-500" flash={flash}>
      <Stat label="Total debt" value={<AnimatedNumber value={r.total_debt} />} />

      {r.debts.length > 0 ? (
        <>
          <ul className="space-y-2 text-sm">
            {r.debts.map((d, i) => (
              <li key={i}>
                <div className="mb-1 flex items-center justify-between">
                  <span>
                    {d.name} <span className="text-xs text-slate-500">@ {d.interest_rate}%{d.min_payment != null ? ` · min ${money(d.min_payment)}` : ''}</span>
                  </span>
                  <span className="tabular-nums">{money(d.amount)}</span>
                </div>
                <Bar percent={(d.amount / maxDebt) * 100} height="h-1.5" color="bg-rose-500" />
              </li>
            ))}
          </ul>

          <div className="grid gap-3 sm:grid-cols-2">
            <PlanBox title="Avalanche" hint="Highest interest first" plan={avalanche} best={avalancheBest} maxMonths={maxMonths} maxInterest={maxInterest} />
            <PlanBox title="Snowball" hint="Smallest balance first" plan={snowball} best={!avalancheBest} maxMonths={maxMonths} maxInterest={maxInterest} />
          </div>

          <PayoffSimulator debts={r.debts} />
        </>
      ) : (
        <p className="text-sm text-emerald-600">No debts on record — nice.</p>
      )}

      {r.recommendations && r.recommendations.length > 0 && (
        <Collapsible title="Ways to speed it up" badge={r.recommendations.length}>
          <ul className="space-y-2">
            {r.recommendations.map((x, i) => (
              <li key={i} className={tipCls}>
                <div className="font-medium">{x.title}</div>
                <p className="mt-1 text-slate-600 dark:text-slate-300">{x.description}</p>
                {x.impact && <p className="mt-1 text-xs font-medium text-rose-600">{x.impact}</p>}
              </li>
            ))}
          </ul>
        </Collapsible>
      )}
    </Card>
  );
}

/* ── Loading / working placeholders ───────────────────────────────────── */

function SkeletonCard({ label }: { label?: string }) {
  return (
    <div className="animate-fade-up space-y-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      {label && <p className="text-xs font-medium text-emerald-600">{label}</p>}
      {[60, 100, 85].map((w, i) => (
        <div key={i} className="shimmer h-3 animate-shimmer rounded bg-slate-100 dark:bg-slate-800" style={{ width: `${w}%` }} />
      ))}
    </div>
  );
}

/* ── Panel ────────────────────────────────────────────────────────────── */

export default function InsightsPanel({ snapshot, flash, busy }: { snapshot: Snapshot | null; flash?: Set<string>; busy?: boolean }) {
  if (!snapshot) {
    return (
      <div className="space-y-4 p-4">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }
  const { financial_data, reports } = snapshot;
  const none = !reports.budget_analysis && !reports.savings_strategy && !reports.debt_reduction;
  const f = (k: string) => flash?.has(k) ?? false;

  return (
    <div className="space-y-4 p-4">
      {busy && <SkeletonCard label="Your coach is working on this…" />}
      <ProfileCard fd={financial_data} flash={f('profile')} />
      {reports.budget_analysis && <BudgetCard r={reports.budget_analysis} flash={f('budget')} />}
      {reports.savings_strategy && <SavingsCard r={reports.savings_strategy} flash={f('savings')} />}
      {reports.debt_reduction && <DebtCard r={reports.debt_reduction} flash={f('debt')} />}
      {none && !busy && (
        <p className="rounded-xl border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500 dark:border-slate-700">
          Analysis cards appear here after you ask for a budget analysis, savings plan, debt plan, or a full review.
        </p>
      )}
    </div>
  );
}

