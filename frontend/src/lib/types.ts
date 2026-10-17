// Mirrors the backend Zod schemas (src/schemas/finance.schema.ts).

export interface User {
  id: string;
  email: string;
  name?: string;
  createdAt: string;
}

export interface Debt {
  name: string;
  amount: number;
  interest_rate: number;
  min_payment: number | null;
}

export interface FinancialData {
  monthly_income: number;
  dependants: number;
  manual_expenses: Record<string, number>;
  debts: Debt[];
}

export interface BudgetAnalysis {
  total_expenses: number;
  monthly_income: number | null;
  spending_categories: { category: string; amount: number; percentage: number | null }[];
  recommendations: { category: string; recommendation: string; potential_savings: number | null }[];
}

export interface SavingsStrategy {
  emergency_fund: { recommended_amount: number; current_amount: number | null; current_status: string };
  recommendations: { category: string; amount: number; rationale: string | null }[];
  automation_techniques: { name: string; description: string }[] | null;
}

export interface PayoffPlan {
  total_interest: number;
  months_to_payoff: number;
  monthly_payment: number | null;
}

export interface DebtReduction {
  total_debt: number;
  debts: Debt[];
  payoff_plans: { avalanche: PayoffPlan; snowball: PayoffPlan };
  recommendations: { title: string; description: string; impact: string | null }[] | null;
}

export interface Reports {
  budget_analysis?: BudgetAnalysis;
  savings_strategy?: SavingsStrategy;
  debt_reduction?: DebtReduction;
}

export interface Snapshot {
  financial_data: FinancialData;
  reports: Reports;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  error?: boolean;
}
