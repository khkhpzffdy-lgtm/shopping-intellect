import type { ListItemView, ShoppingListRecord } from '../storage/db';
import { useListModeStore } from '../store/listMode';

type ListScreenProps = {
  list: ShoppingListRecord;
  items: ListItemView[];
  pendingCounts: Record<string, number>;
  errorMessage: string | null;
  draft: {
    term: string;
    quantity: string;
    unit: string;
  };
  onDraftChange: (field: 'term' | 'quantity' | 'unit', value: string) => void;
  onBack: () => void;
  onAddItem: () => void;
  onToggleChecked: (item: ListItemView) => void;
  onRemoveItem: (item: ListItemView) => void;
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

export const ListScreen = ({
  list,
  items,
  pendingCounts,
  errorMessage,
  draft,
  onDraftChange,
  onBack,
  onAddItem,
  onToggleChecked,
  onRemoveItem
}: ListScreenProps) => {
  const mode = useListModeStore((state) => state.modes[list.client_uuid] ?? 'planning');
  const setMode = useListModeStore((state) => state.setMode);

  return (
    <section className="space-y-4">
      <div
        className="p-5"
        style={{ background: 'var(--card)', borderRadius: 'var(--radius)', border: '1px solid var(--card-border)', boxShadow: 'var(--shadow)' }}
      >
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onBack}
            className="px-4 py-2"
            style={{ borderRadius: 'var(--radius-sm)', border: '1px solid var(--line)', color: 'var(--ink-2)', fontSize: 'var(--fs-sm)', fontWeight: 600 }}
          >
            Back
          </button>
          <SyncStatusIndicator pendingCount={pendingCounts[list.client_uuid] ?? 0} />
        </div>

        <h2 className="mt-4" style={{ color: 'var(--ink)', fontSize: 'var(--fs-display)', fontWeight: 600 }}>
          {list.name}
        </h2>

        <div className="mt-5 inline-flex p-1" style={{ background: 'var(--card-2)', borderRadius: 'var(--radius-sm)' }}>
          {(['planning', 'shopping'] as const).map((nextMode) => (
            <button
              key={nextMode}
              type="button"
              onClick={() => setMode(list.client_uuid, nextMode)}
              aria-pressed={mode === nextMode}
              style={{
                borderRadius: 'var(--radius-sm)',
                fontSize: 'var(--fs-xs)',
                padding: '8px 14px',
                fontWeight: 600,
                textTransform: 'capitalize',
                background: mode === nextMode ? 'var(--accent)' : 'transparent',
                color: mode === nextMode ? 'var(--on-accent)' : 'var(--ink-2)'
              }}
            >
              {nextMode}
            </button>
          ))}
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-[1.6fr_0.7fr_0.7fr_auto]">
          <input
            aria-label="Item term"
            value={draft.term}
            onChange={(event) => onDraftChange('term', event.target.value)}
            placeholder="мляко"
            className="px-4 py-3 outline-none"
            style={{ borderRadius: 'var(--radius-sm)', background: 'var(--input)', color: 'var(--ink)', border: '1px solid var(--line)' }}
          />
          <input
            aria-label="Item quantity"
            value={draft.quantity}
            onChange={(event) => onDraftChange('quantity', event.target.value)}
            placeholder="2"
            className="px-4 py-3 outline-none"
            style={{ borderRadius: 'var(--radius-sm)', background: 'var(--input)', color: 'var(--ink)', border: '1px solid var(--line)' }}
          />
          <input
            aria-label="Item unit"
            value={draft.unit}
            onChange={(event) => onDraftChange('unit', event.target.value)}
            placeholder="piece"
            className="px-4 py-3 outline-none"
            style={{ borderRadius: 'var(--radius-sm)', background: 'var(--input)', color: 'var(--ink)', border: '1px solid var(--line)' }}
          />
          <button
            type="button"
            onClick={onAddItem}
            className="px-5 py-3 transition hover:brightness-105"
            style={{ borderRadius: 'var(--radius-sm)', background: 'var(--accent)', color: 'var(--on-accent)', fontSize: 'var(--fs-sm)', fontWeight: 600 }}
          >
            Add item
          </button>
        </div>
        {errorMessage ? (
          <p className="mt-3" role="alert" style={{ color: 'var(--danger)', fontSize: 'var(--fs-sm)' }}>
            {errorMessage}
          </p>
        ) : null}
      </div>

      <div className="grid gap-3">
        {items.length === 0 ? (
          <section
            className="p-6"
            style={{ background: 'var(--card)', borderRadius: 'var(--radius)', border: '1px solid var(--card-border)' }}
          >
            <p style={{ color: 'var(--ink-2)', fontSize: 'var(--fs-body)' }}>This list is empty for now.</p>
          </section>
        ) : null}

        {items.map((item) =>
          mode === 'planning' ? (
            <article
              key={item.client_uuid}
              data-testid={`list-item-${item.client_uuid}`}
              className="flex items-start justify-between gap-3 p-5"
              style={{ background: 'var(--card)', borderRadius: 'var(--radius)', border: '1px solid var(--card-border)' }}
            >
              <div>
                <p style={{ color: 'var(--ink)', fontSize: 'var(--fs-title)', fontWeight: 600 }}>{item.term}</p>
                <p className="mt-2" style={{ color: 'var(--ink-2)', fontSize: 'var(--fs-body)' }}>
                  {item.quantity} {item.unit}
                </p>
                <p className="mt-3" style={{ color: 'var(--ink-3)', fontSize: 'var(--fs-xs)' }}>
                  Expand details soon
                </p>
              </div>
              <div className="flex items-center gap-2">
                <SyncStatusIndicator pendingCount={pendingCounts[item.client_uuid] ?? 0} />
                <button
                  type="button"
                  onClick={() => onRemoveItem(item)}
                  style={{ color: 'var(--danger)', fontSize: 'var(--fs-sm)', fontWeight: 600 }}
                >
                  Remove
                </button>
              </div>
            </article>
          ) : (
            <article
              key={item.client_uuid}
              data-testid={`list-item-${item.client_uuid}`}
              className="flex items-center justify-between gap-3 p-5"
              style={{ background: item.is_checked ? 'var(--accent-tint)' : 'var(--card)', borderRadius: 'var(--radius)', border: '1px solid var(--card-border)' }}
            >
              <button
                type="button"
                onClick={() => onToggleChecked(item)}
                aria-pressed={item.is_checked}
                className="flex flex-1 items-center gap-4 text-left"
              >
                <span
                  aria-hidden="true"
                  style={{
                    display: 'inline-flex',
                    width: '26px',
                    height: '26px',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: '999px',
                    border: '2px solid var(--accent)',
                    background: item.is_checked ? 'var(--accent)' : 'transparent',
                    color: 'var(--on-accent)',
                    fontSize: 'var(--fs-sm)',
                    fontWeight: 700
                  }}
                >
                  {item.is_checked ? '✓' : ''}
                </span>
                <div>
                  <p style={{ color: 'var(--ink)', fontSize: 'var(--fs-h2)', fontWeight: 600 }}>{item.term}</p>
                  <p className="mt-1" style={{ color: 'var(--ink-2)', fontSize: 'var(--fs-body)' }}>
                    {item.quantity} {item.unit}
                  </p>
                </div>
              </button>
              <div className="flex items-center gap-2">
                <SyncStatusIndicator pendingCount={pendingCounts[item.client_uuid] ?? 0} />
                <button
                  type="button"
                  onClick={() => onRemoveItem(item)}
                  style={{ color: 'var(--danger)', fontSize: 'var(--fs-sm)', fontWeight: 600 }}
                >
                  Remove
                </button>
              </div>
            </article>
          )
        )}
      </div>
    </section>
  );
};
