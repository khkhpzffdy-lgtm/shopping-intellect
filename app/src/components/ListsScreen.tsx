import { useState } from 'react';
import type { ShoppingListRecord } from '../storage/db';
import { SyncStatusIndicator } from './SyncStatusIndicator';

type ListsScreenProps = {
  lists: ShoppingListRecord[];
  itemCounts: Record<string, number>;
  mutationStatusCounts: Record<string, { pending: number; failed: number }>;
  createName: string;
  errorMessage: string | null;
  onCreateNameChange: (value: string) => void;
  onCreateList: () => void;
  onOpenList: (listKey: string) => void;
  theme: 'light' | 'dark';
  onSetTheme: (theme: 'light' | 'dark') => void;
  onLogout: () => void;
};

export const ListsScreen = ({
  lists,
  itemCounts,
  mutationStatusCounts,
  createName,
  errorMessage,
  onCreateNameChange,
  onCreateList,
  onOpenList,
  theme,
  onSetTheme,
  onLogout
}: ListsScreenProps) => {
  const [creating, setCreating] = useState(false);

  const submitCreate = () => {
    onCreateList();
    setCreating(false);
  };

  return (
    <section className="space-y-4">
      <div className="appbar">
        <div className="appbar__title">
          Shopping <b>Intellect</b>
        </div>
        <div className="inline-flex p-1" style={{ background: 'var(--card-2)', borderRadius: 'var(--radius-sm)' }}>
          <button
            type="button"
            aria-label="Светла тема"
            onClick={() => onSetTheme('light')}
            style={{
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--fs-xs)',
              padding: '6px 12px',
              fontWeight: 600,
              border: 'none',
              cursor: 'pointer',
              background: theme === 'light' ? 'var(--accent)' : 'transparent',
              color: theme === 'light' ? 'var(--on-accent)' : 'var(--ink-2)'
            }}
          >
            Светла
          </button>
          <button
            type="button"
            aria-label="Тъмна тема"
            onClick={() => onSetTheme('dark')}
            style={{
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--fs-xs)',
              padding: '6px 12px',
              fontWeight: 600,
              border: 'none',
              cursor: 'pointer',
              background: theme === 'dark' ? 'var(--accent)' : 'transparent',
              color: theme === 'dark' ? 'var(--on-accent)' : 'var(--ink-2)'
            }}
          >
            Тъмна
          </button>
        </div>
        <button
          type="button"
          onClick={onLogout}
          className="px-3 py-2 transition"
          style={{ borderRadius: 'var(--radius-sm)', border: '1px solid var(--line)', color: 'var(--ink-2)', fontSize: 'var(--fs-xs)', fontWeight: 600, background: 'none', cursor: 'pointer' }}
        >
          Sign out
        </button>
      </div>

      <div className="addbar">
        <button
          type="button"
          className="addbar__plus"
          aria-label="New list"
          onClick={() => setCreating((value) => !value)}
        >
          +
        </button>
        {creating ? (
          <input
            aria-label="List name"
            value={createName}
            autoFocus
            onChange={(event) => onCreateNameChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                submitCreate();
              }
            }}
            placeholder="Списък…"
            className="addbar__field"
          />
        ) : (
          <span className="addbar__field" style={{ color: 'var(--placeholder)' }} onClick={() => setCreating(true)}>
            Нов списък…
          </span>
        )}
        {creating ? (
          <button
            type="button"
            onClick={submitCreate}
            style={{ color: 'var(--accent)', fontSize: 'var(--fs-sm)', fontWeight: 700, background: 'none', border: 'none', cursor: 'pointer' }}
          >
            Create list
          </button>
        ) : null}
      </div>

      {errorMessage ? (
        <p role="alert" style={{ color: 'var(--danger)', fontSize: 'var(--fs-sm)' }}>
          {errorMessage}
        </p>
      ) : null}

      {lists.length === 0 ? (
        <section
          className="p-8"
          style={{ background: 'var(--card)', borderRadius: 'var(--radius)', border: '1px solid var(--card-border)', boxShadow: 'var(--shadow)' }}
        >
          <h2 style={{ color: 'var(--ink)', fontSize: 'var(--fs-display)', fontWeight: 600 }}>No lists yet</h2>
          <p className="mt-3 max-w-xl" style={{ color: 'var(--ink-2)', fontSize: 'var(--fs-body)', lineHeight: 1.6 }}>
            Започни с име по-горе и първият ти списък ще се появи веднага, дори офлайн.
          </p>
        </section>
      ) : null}

      <div className="grid gap-3">
        {lists.map((list) => (
          <button key={list.client_uuid} type="button" onClick={() => onOpenList(list.client_uuid)} className="listcard">
            <div>
              <h2 className="listcard__name">{list.name}</h2>
              <p className="listcard__meta">{itemCounts[list.client_uuid] ?? 0} items</p>
            </div>
            <SyncStatusIndicator
              pending={mutationStatusCounts[list.client_uuid]?.pending ?? 0}
              failed={mutationStatusCounts[list.client_uuid]?.failed ?? 0}
            />
          </button>
        ))}
      </div>
    </section>
  );
};
