import { useState } from 'react';
import type { ShoppingListRecord } from '../storage/db';

type ListsScreenProps = {
  lists: ShoppingListRecord[];
  itemCounts: Record<string, number>;
  pendingCounts: Record<string, number>;
  createName: string;
  errorMessage: string | null;
  onCreateNameChange: (value: string) => void;
  onCreateList: () => void;
  onOpenList: (listKey: string) => void;
};

const SyncStatusIndicator = ({ pendingCount }: { pendingCount: number }) => (
  <span className="listcard__badge">
    <span className={`sync__dot${pendingCount > 0 ? ' sync__dot--pending' : ''}`} aria-hidden="true" />
    {pendingCount > 0 ? `sync-pending ${pendingCount}` : 'synced'}
  </span>
);

export const ListsScreen = ({
  lists,
  itemCounts,
  pendingCounts,
  createName,
  errorMessage,
  onCreateNameChange,
  onCreateList,
  onOpenList
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
            <SyncStatusIndicator pendingCount={pendingCounts[list.client_uuid] ?? 0} />
          </button>
        ))}
      </div>
    </section>
  );
};
