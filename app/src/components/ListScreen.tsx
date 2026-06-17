import type { ListItemView, ShoppingListRecord } from '../storage/db';
import { useListModeStore } from '../store/listMode';
import { SyncStatusIndicator } from './SyncStatusIndicator';

type ListScreenProps = {
  list: ShoppingListRecord;
  items: ListItemView[];
  mutationStatusCounts: Record<string, { pending: number; failed: number }>;
  errorMessage: string | null;
  draft: {
    term: string;
    quantity: string;
    unit: string;
  };
  onDraftChange: (field: 'term' | 'quantity' | 'unit', value: string) => void;
  onBack: () => void;
  onAddItem: () => void;
  onOpenAddSearch: () => void;
  onToggleChecked: (item: ListItemView) => void;
  onRemoveItem: (item: ListItemView) => void;
};

const ITEM_EMOJI = '🛒';

export const ListScreen = ({
  list,
  items,
  mutationStatusCounts,
  errorMessage,
  draft,
  onDraftChange,
  onBack,
  onAddItem,
  onOpenAddSearch,
  onToggleChecked,
  onRemoveItem
}: ListScreenProps) => {
  const mode = useListModeStore((state) => state.modes[list.client_uuid] ?? 'planning');
  const setMode = useListModeStore((state) => state.setMode);

  return (
    <section className="space-y-4">
      <div className="appbar">
        <button type="button" onClick={onBack} className="iconbtn" aria-label="Back">
          ←
        </button>
        <div className="appbar__title">{list.name}</div>
        <button type="button" onClick={onOpenAddSearch} className="iconbtn" aria-label="Search">
          🔍
        </button>
        <SyncStatusIndicator
          pending={mutationStatusCounts[list.client_uuid]?.pending ?? 0}
          failed={mutationStatusCounts[list.client_uuid]?.failed ?? 0}
        />
      </div>

      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <div className="modeseg">
          {(['planning', 'shopping'] as const).map((nextMode) => (
            <button
              key={nextMode}
              type="button"
              className="modeseg__opt"
              onClick={() => setMode(list.client_uuid, nextMode)}
              aria-pressed={mode === nextMode}
              data-on={mode === nextMode}
            >
              {nextMode}
            </button>
          ))}
        </div>
      </div>

      <div className="addbar">
        <button type="button" className="addbar__plus" aria-label="Add item" onClick={onAddItem}>
          +
        </button>
        <input
          aria-label="Item term"
          value={draft.term}
          onChange={(event) => onDraftChange('term', event.target.value)}
          placeholder="мляко"
          className="addbar__field"
        />
        <input
          aria-label="Item quantity"
          value={draft.quantity}
          onChange={(event) => onDraftChange('quantity', event.target.value)}
          placeholder="2"
          className="addbar__field"
          style={{ flex: '0 0 48px' }}
        />
        <input
          aria-label="Item unit"
          value={draft.unit}
          onChange={(event) => onDraftChange('unit', event.target.value)}
          placeholder="бр."
          className="addbar__field"
          style={{ flex: '0 0 64px' }}
        />
      </div>
      {errorMessage ? (
        <p role="alert" style={{ color: 'var(--danger)', fontSize: 'var(--fs-sm)' }}>
          {errorMessage}
        </p>
      ) : null}

      <div className="glist">
        {items.length === 0 ? (
          <section
            className="p-6"
            style={{ background: 'var(--card)', borderRadius: 'var(--radius)', border: '1px solid var(--card-border)' }}
          >
            <p style={{ color: 'var(--ink-2)', fontSize: 'var(--fs-body)' }}>Този списък все още е празен.</p>
          </section>
        ) : null}

        {items.map((item) =>
          mode === 'planning' ? (
            <article key={item.client_uuid} data-testid={`list-item-${item.client_uuid}`} className="git">
              <span className="git__emoji">{ITEM_EMOJI}</span>
              <div className="git__main">
                <div className="git__name">{item.term}</div>
                <div className="git__sub">
                  {item.quantity} {item.unit}
                </div>
                <p style={{ color: 'var(--ink-3)', fontSize: 'var(--fs-xs)', marginTop: '4px' }}>Expand details soon</p>
              </div>
              <SyncStatusIndicator
                pending={mutationStatusCounts[item.client_uuid]?.pending ?? 0}
                failed={mutationStatusCounts[item.client_uuid]?.failed ?? 0}
              />
              <button type="button" onClick={() => onRemoveItem(item)} className="git__remove">
                Премахни
              </button>
            </article>
          ) : (
            <article
              key={item.client_uuid}
              data-testid={`list-item-${item.client_uuid}`}
              className={`git git--shop${item.is_checked ? ' git--done' : ''}`}
            >
              <button
                type="button"
                onClick={() => onToggleChecked(item)}
                aria-pressed={item.is_checked}
                className="flex flex-1 items-center gap-4 text-left"
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
              >
                <span className="checkbox" aria-hidden="true">
                  {item.is_checked ? '✓' : ''}
                </span>
                <span className="git__emoji">{ITEM_EMOJI}</span>
                <div className="git__main">
                  <div className="git__name">{item.term}</div>
                </div>
                <span className="git__qty">
                  {item.quantity} {item.unit}
                </span>
              </button>
              <SyncStatusIndicator
                pending={mutationStatusCounts[item.client_uuid]?.pending ?? 0}
                failed={mutationStatusCounts[item.client_uuid]?.failed ?? 0}
              />
              <button type="button" onClick={() => onRemoveItem(item)} className="git__remove">
                Премахни
              </button>
            </article>
          )
        )}
      </div>
    </section>
  );
};
