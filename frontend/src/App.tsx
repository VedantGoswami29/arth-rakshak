import { useCallback, useEffect, useRef, useState } from 'react';
import AccountMenu from './components/AccountMenu';
import AuthForm from './components/AuthForm';
import ChatPanel from './components/ChatPanel';
import InsightsPanel from './components/InsightsPanel';
import { ToastProvider, useToast } from './components/toast';
import { btnGhost } from './components/ui';
import { ThemeToggle } from './components/widgets';
import { api } from './lib/api';
import { useAuth } from './lib/auth';
import type { OnSaved } from './components/ProfileEditor';
import { diffSnapshot } from './lib/diff';
import type { Snapshot } from './lib/types';

const newThreadId = () => `t_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`; // matches /^[A-Za-z0-9_-]{1,64}$/
const threadKey = (userId: string) => `fc_thread_${userId}`;

export default function App() {
  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  );
}

function Shell() {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex h-full items-center justify-center text-sm text-slate-500">Loading…</div>;
  if (!user) return <AuthForm />;
  return <Workspace userId={user.id} />;
}

function Workspace({ userId }: { userId: string }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [tab, setTab] = useState<'chat' | 'insights'>('chat');
  const [threadId, setThreadId] = useState<string>(() => localStorage.getItem(threadKey(userId)) ?? 'default');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false); // profile edited after the latest analysis
  const [flash, setFlash] = useState<Set<string>>(new Set());
  const prev = useRef<Snapshot | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const toast = useToast();

  // Every snapshot (chat stream or manual refresh) goes through here: toast + highlight what changed.
  const applySnapshot = useCallback(
    (s: Snapshot, opts?: { silent?: boolean }) => {
      const before = prev.current;
      prev.current = s;
      setSnapshot(s);
      if (!before) return; // first load: nothing "changed"
      const { keys, messages } = diffSnapshot(before, s);
      if (keys.some((k) => k !== 'profile')) setStale(false); // a fresh analysis arrived
      if (opts?.silent || keys.length === 0) return;
      setFlash(new Set(keys));
      clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlash(new Set()), 1700);
      messages.slice(0, 2).forEach((text, i) =>
        toast({ text, action: i === 0 ? { label: 'View', onClick: () => setTab('insights') } : undefined }),
      );
    },
    [toast],
  );

  // Manual edits from the profile editor: update silently, remember the analyses are now stale, offer Undo.
  const onProfileSaved = useCallback<OnSaved>(
    (s, text, undo) => {
      applySnapshot(s, { silent: true });
      setStale(true);
      toast({
        text,
        action: undo
          ? {
              label: 'Undo',
              onClick: () => {
                void undo()
                  .then((u) => applySnapshot(u, { silent: true }))
                  .catch(() => toast({ text: 'Could not undo that change' }));
              },
            }
          : undefined,
      });
    },
    [applySnapshot, toast],
  );

  const refresh = useCallback(() => {
    api
      .state()
      .then((s) => {
        applySnapshot(s);
        setLoadError(null);
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : 'Could not load your data'));
  }, [applySnapshot]);

  useEffect(() => () => clearTimeout(flashTimer.current), []);

  useEffect(refresh, [refresh]);

  function newChat() {
    const id = newThreadId();
    localStorage.setItem(threadKey(userId), id);
    setThreadId(id);
    setTab('chat');
  }

  const tabBtn = (t: 'chat' | 'insights', label: string) => (
    <button
      onClick={() => setTab(t)}
      className={`flex-1 py-2 text-sm font-medium transition-colors ${tab === t ? 'border-b-2 border-emerald-600 text-emerald-700 dark:text-emerald-400' : 'text-slate-500'}`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-2.5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-sm">📈</span>
          <h1 className="text-sm font-semibold sm:text-base">AI Financial Coach</h1>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={newChat} className={`${btnGhost} active:scale-95`}>New chat</button>
          <ThemeToggle />
          <AccountMenu
            onDataDeleted={() => {
              prev.current = null; // don't toast the wipe as a "change"
              setStale(false);
              refresh();
            }}
          />
        </div>
      </header>

      {/* Indeterminate progress bar while the coach is working */}
      <div className={`h-0.5 overflow-hidden bg-emerald-100 transition-opacity dark:bg-emerald-950 ${busy ? 'opacity-100' : 'opacity-0'}`}>
        <div className="h-full w-1/3 animate-indeterminate bg-emerald-500" />
      </div>

      {/* Mobile tabs */}
      <div className="flex border-b border-slate-200 bg-white md:hidden dark:border-slate-800 dark:bg-slate-900">
        {tabBtn('chat', 'Chat')}
        {tabBtn('insights', 'Insights')}
      </div>

      {loadError && <p className="bg-red-50 px-4 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{loadError}</p>}

      <main className="grid min-h-0 flex-1 md:grid-cols-[minmax(0,1fr)_minmax(0,28rem)] lg:grid-cols-[minmax(0,1fr)_minmax(0,32rem)]">
        <section className={`${tab === 'chat' ? 'flex' : 'hidden'} min-h-0 flex-col md:flex`}>
          <ChatPanel key={threadId} userId={userId} threadId={threadId} onSnapshot={applySnapshot} onBusyChange={setBusy} />
        </section>
        <aside className={`${tab === 'insights' ? 'block' : 'hidden'} min-h-0 overflow-y-auto border-slate-200 bg-slate-50 md:block md:border-l dark:border-slate-800 dark:bg-slate-950`}>
          <InsightsPanel snapshot={snapshot} flash={flash} busy={busy} stale={stale} onProfileSaved={onProfileSaved} />
        </aside>
      </main>
    </div>
  );
}
