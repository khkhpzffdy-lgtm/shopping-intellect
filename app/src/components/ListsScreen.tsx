import type { ShoppingListRecord } from '../storage/db';

type ListsScreenProps = {
  lists: ShoppingListRecord[];
  itemCounts: Record<string, number>;
  pendingCounts: Record<string, number>;
  createName: string;
  onCreateNameChange: (value: string) => void;
  onCreateList: () => void;
  onOpenList: (listKey: string) => void;
};

const SyncStatusIndicator = ({ pendingCount }: { pendingCount: number }) => (
  <span
    style={{
      borderRadius: '999px',
      padding: '4px 10px',
      background: pendingCount > 0 ? 'var(--accent-soft)' : 'var(--card-2)',
      color: pendingCount > 0 ? 'var(--accent)' : 'var(--ink-2)',
      fontSize: 'var(--fs-xs)',
      fontWeight: 600
    }}
  >
    {pendingCount > 0 ? `sync-pending ${pendingCount}` : 'synced'}
  </span>
);

export const ListsScreen = ({
  lists,
  itemCounts,
  pendingCounts,
  createName,
  onCreateNameChange,
  onCreateList,
  onOpenList
}: ListsScreenProps) => (
  <section className="space-y-4">
    <div
      className="p-5"
      style={{ background: 'var(--card)', borderRadius: 'var(--radius)', border: '1px solid var(--card-border)', boxShadow: 'var(--shadow)' }}
    >
      <p style={{ color: 'var(--accent)', fontSize: 'var(--fs-xs)', fontWeight: 600, letterSpacing: '0.16em', textTransform: 'uppercase' }}>
        Lists overview
      </p>
      <div className="mt-4 flex flex-col gap-3 md:flex-row">
        <input
          aria-label="List name"
          value={createName}
          onChange={(event) => onCreateNameChange(event.target.value)}
          placeholder="Weekly groceries"
          className="flex-1 px-4 py-3 outline-none"
          style={{ borderRadius: 'var(--radius-sm)', background: 'var(--input)', color: 'var(--ink)', border: '1px solid var(--line)' }}
        />
        <button
          type="button"
          onClick={onCreateList}
          className="px-5 py-3 transition hover:brightness-105"
          style={{ borderRadius: 'var(--radius-sm)', background: 'var(--accent)', color: 'var(--on-accent)', fontSize: 'var(--fs-sm)', fontWeight: 600 }}
        >
          Create list
        </button>
      </div>
    </div>

    {lists.length === 0 ? (
      <section
        className="p-8"
        style={{ background: 'var(--card)', borderRadius: 'var(--radius)', border: '1px solid var(--card-border)', boxShadow: 'var(--shadow)' }}
      >
        <h2 style={{ color: 'var(--ink)', fontSize: 'var(--fs-display)', fontWeight: 600 }}>No lists yet</h2>
        <p className="mt-3 max-w-xl" style={{ color: 'var(--ink-2)', fontSize: 'var(--fs-body)', lineHeight: 1.6 }}>
          Start with a name above and your first shopping list will appear instantly, even offline.
        </p>
      </section>
    ) : null}

    <div className="grid gap-4">
      {lists.map((list) => (
        <button
          key={list.client_uuid}
          type="button"
          onClick={() => onOpenList(list.client_uuid)}
          className="w-full p-5 text-left transition hover:-translate-y-0.5"
          style={{ background: 'var(--card)', borderRadius: 'var(--radius)', border: '1px solid var(--card-border)', boxShadow: 'var(--shadow)' }}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 style={{ color: 'var(--ink)', fontSize: 'var(--fs-h1)', fontWeight: 600 }}>{list.name}</h2>
              <p className="mt-2" style={{ color: 'var(--ink-2)', fontSize: 'var(--fs-body)' }}>
                {itemCounts[list.client_uuid] ?? 0} items
              </p>
            </div>
            <SyncStatusIndicator pendingCount={pendingCounts[list.client_uuid] ?? 0} />
          </div>
        </button>
      ))}
    </div>
  </section>
);
