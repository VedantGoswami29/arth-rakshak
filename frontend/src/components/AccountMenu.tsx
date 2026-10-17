import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { btnGhost, btnPrimary, ErrorText, inputCls, Modal } from './ui';

type Dialog = 'password' | 'delete-data' | 'delete-account' | null;

export default function AccountMenu({ onDataDeleted }: { onDataDeleted: () => void }) {
  const { user, logout, replaceToken } = useAuth();
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  if (!user) return null;
  const item = 'block w-full px-3 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800';
  const pick = (d: Dialog) => {
    setOpen(false);
    setDialog(d);
  };

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} className={btnGhost} aria-haspopup="menu" aria-expanded={open}>
        <span className="max-w-[10rem] truncate">{user.name || user.email}</span>
        <span className="ml-1 text-xs">▾</span>
      </button>

      {open && (
        <div role="menu" className="absolute right-0 z-40 mt-2 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
          <div className="truncate border-b border-slate-100 px-3 py-2 text-xs text-slate-500 dark:border-slate-800">{user.email}</div>
          <button className={item} onClick={() => pick('password')}>Change password</button>
          <button
            className={item}
            onClick={async () => {
              setOpen(false);
              try {
                await api.logoutAll();
              } finally {
                logout();
              }
            }}
          >
            Sign out everywhere
          </button>
          <button className={`${item} text-amber-700 dark:text-amber-400`} onClick={() => pick('delete-data')}>Delete my financial data</button>
          <button className={`${item} text-red-600`} onClick={() => pick('delete-account')}>Delete account</button>
          <button className={`${item} border-t border-slate-100 dark:border-slate-800`} onClick={logout}>Sign out</button>
        </div>
      )}

      {dialog === 'password' && <PasswordDialog onClose={() => setDialog(null)} onToken={replaceToken} />}
      {dialog === 'delete-data' && (
        <ConfirmDialog
          title="Delete financial data?"
          body="This erases your profile, expenses, debts and every saved analysis. Your account stays."
          confirmLabel="Delete data"
          onClose={() => setDialog(null)}
          action={async () => {
            await api.deleteData();
            onDataDeleted();
          }}
        />
      )}
      {dialog === 'delete-account' && (
        <ConfirmDialog
          title="Delete your account?"
          body="This permanently erases your account, chat history and all financial data. It cannot be undone."
          confirmLabel="Delete account"
          needPassword
          onClose={() => setDialog(null)}
          action={async (password) => {
            await api.deleteAccount(password!);
            logout();
          }}
        />
      )}
    </div>
  );
}

function PasswordDialog({ onClose, onToken }: { onClose: () => void; onToken: (t: string) => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { token } = await api.changePassword(current, next);
      onToken(token); // other sessions are signed out; keep this one
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Change password" onClose={onClose}>
      {done ? (
        <div className="space-y-3 text-sm">
          <p>Password updated. All other devices have been signed out.</p>
          <button className={btnPrimary} onClick={onClose}>Close</button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <input className={inputCls} type="password" placeholder="Current password" required value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
          <input className={inputCls} type="password" placeholder="New password (min 10 chars)" required minLength={10} value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
          {error && <ErrorText>{error}</ErrorText>}
          <button className={`${btnPrimary} w-full`} disabled={busy}>{busy ? 'Saving…' : 'Update password'}</button>
        </form>
      )}
    </Modal>
  );
}

function ConfirmDialog(props: {
  title: string;
  body: string;
  confirmLabel: string;
  needPassword?: boolean;
  onClose: () => void;
  action: (password?: string) => Promise<void>;
}) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await props.action(props.needPassword ? password : undefined);
      props.onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
      setBusy(false);
    }
  }

  return (
    <Modal title={props.title} onClose={props.onClose}>
      <form onSubmit={submit} className="space-y-3">
        <p className="text-sm text-slate-600 dark:text-slate-300">{props.body}</p>
        {props.needPassword && (
          <input className={inputCls} type="password" placeholder="Confirm with your password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        )}
        {error && <ErrorText>{error}</ErrorText>}
        <div className="flex justify-end gap-2">
          <button type="button" className={btnGhost} onClick={props.onClose}>Cancel</button>
          <button className="inline-flex items-center rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50" disabled={busy}>
            {busy ? 'Working…' : props.confirmLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
