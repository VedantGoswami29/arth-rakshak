import { useState, type FormEvent } from 'react';
import { useAuth } from '../lib/auth';
import { btnPrimary, ErrorText, inputCls } from './ui';

export default function AuthForm() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'login') await login(email, password);
      else await register(email, password, name.trim() || undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-600 text-xl text-white">📈</div>
          <h1 className="text-2xl font-semibold">AI Financial Coach</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Budget, savings and debt-payoff guidance, private to you.</p>
        </div>

        <form onSubmit={submit} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1 text-sm dark:bg-slate-800">
            {(['login', 'register'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMode(m);
                  setError(null);
                }}
                className={`rounded-md py-1.5 font-medium transition ${
                  mode === m ? 'bg-white shadow-sm dark:bg-slate-700' : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                {m === 'login' ? 'Sign in' : 'Create account'}
              </button>
            ))}
          </div>

          {mode === 'register' && (
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Name (optional)</span>
              <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={100} />
            </label>
          )}
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Email</span>
            <input className={inputCls} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Password</span>
            <input
              className={inputCls}
              type="password"
              required
              minLength={mode === 'register' ? 10 : 1}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
            {mode === 'register' && <span className="mt-1 block text-xs text-slate-500">At least 10 characters.</span>}
          </label>

          {error && <ErrorText>{error}</ErrorText>}

          <button className={`${btnPrimary} w-full`} disabled={busy}>
            {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>
      </div>
    </div>
  );
}
