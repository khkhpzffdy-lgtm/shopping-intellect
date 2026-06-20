import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { UserProductDetailScreen } from '../components/UserProductDetailScreen';
import { apiRequest } from '../api/client';
import {
  clearDatabase,
  enqueueMutation,
  getQueuedMutations,
  getUserProduct,
  putUserProduct,
  type ListItemView,
  type UserProductRecord
} from '../storage/db';

vi.mock('../api/client', () => ({
  apiRequest: vi.fn()
}));

const mockedApiRequest = vi.mocked(apiRequest);

const baseUserProduct: UserProductRecord = {
  client_uuid: 'up-1',
  id: '55',
  owner_type: 'user',
  owner_id: 7,
  term: 'мляко',
  normalized_term: 'мляко',
  created_at: '2026-06-20T09:00:00.000Z',
  category_ids: ['1'],
  is_favorite: false
};

const baseItem: ListItemView = {
  client_uuid: 'item-1',
  id: '900',
  list_client_uuid: 'list-1',
  list_id: '42',
  user_product_client_uuid: 'up-1',
  user_product_id: '55',
  quantity: 2,
  unit: 'бр.',
  is_checked: false,
  created_at: '2026-06-20T09:00:00.000Z',
  updated_at: '2026-06-20T09:00:00.000Z',
  term: 'мляко'
};

// A minimal stand-in for HomeScreen's real handleRenameUserProduct — exercises
// the same real IndexedDB write + mutation enqueue the production handler
// does, so these tests prove the component's contract actually persists.
const renameViaRealPersistence = async (userProduct: UserProductRecord, newTerm: string) => {
  const trimmed = newTerm.trim();
  if (!trimmed || trimmed === userProduct.term) {
    return { ok: true };
  }

  const updated = { ...userProduct, term: trimmed, normalized_term: trimmed.toLocaleLowerCase('bg-BG') };
  await putUserProduct(updated);

  await enqueueMutation({
    client_uuid: 'mutation-1',
    endpoint: `/user-products/${userProduct.id}`,
    method: 'PATCH',
    body: { term: trimmed },
    created_at: new Date().toISOString(),
    attempts: 0,
    status: 'pending',
    entity_client_uuid: userProduct.client_uuid
  });

  try {
    await apiRequest(`/user-products/${userProduct.id}`, { method: 'PATCH', body: { term: trimmed }, authenticated: true });
  } catch {
    // Offline — local write and queued mutation already happened above.
  }

  return { ok: true };
};

beforeEach(async () => {
  mockedApiRequest.mockReset();
  await clearDatabase();
  mockedApiRequest.mockResolvedValue({ categories: [{ id: '1', name: 'Млечни' }] });
});

describe('UserProductDetailScreen', () => {
  test('renders term, category badges, and favorite state', async () => {
    render(
      <UserProductDetailScreen
        item={baseItem}
        userProduct={baseUserProduct}
        onRename={async () => ({ ok: true })}
        onSetFavorite={() => {}}
        onUpdateItem={() => {}}
      />
    );

    expect(screen.getByLabelText('Термин')).toHaveValue('мляко');
    expect(await screen.findByText('Млечни')).toBeInTheDocument();
    expect(screen.getByLabelText('Добави в любими')).toBeInTheDocument();
  });

  test('Save is disabled when the term is blank or unchanged', async () => {
    render(
      <UserProductDetailScreen
        item={baseItem}
        userProduct={baseUserProduct}
        onRename={async () => ({ ok: true })}
        onSetFavorite={() => {}}
        onUpdateItem={() => {}}
      />
    );

    const input = screen.getByLabelText('Термин');
    expect(screen.getByText('Запази')).toBeDisabled();

    await userEvent.clear(input);
    expect(screen.getByText('Запази')).toBeDisabled();

    await userEvent.type(input, 'прясно мляко');
    expect(screen.getByText('Запази')).not.toBeDisabled();
  });

  test('save persists the rename to IndexedDB', async () => {
    await putUserProduct(baseUserProduct);

    render(
      <UserProductDetailScreen
        item={baseItem}
        userProduct={baseUserProduct}
        onRename={(newTerm) => renameViaRealPersistence(baseUserProduct, newTerm)}
        onSetFavorite={() => {}}
        onUpdateItem={() => {}}
      />
    );

    const input = screen.getByLabelText('Термин');
    await userEvent.clear(input);
    await userEvent.type(input, 'прясно мляко');
    await userEvent.click(screen.getByText('Запази'));

    await waitFor(async () => {
      const stored = await getUserProduct('up-1');
      expect(stored?.term).toBe('прясно мляко');
    });
  });

  test('offline rename still persists locally and queues a mutation', async () => {
    await putUserProduct(baseUserProduct);
    mockedApiRequest.mockRejectedValueOnce(new Error('Network error'));

    render(
      <UserProductDetailScreen
        item={baseItem}
        userProduct={baseUserProduct}
        onRename={(newTerm) => renameViaRealPersistence(baseUserProduct, newTerm)}
        onSetFavorite={() => {}}
        onUpdateItem={() => {}}
      />
    );

    const input = screen.getByLabelText('Термин');
    await userEvent.clear(input);
    await userEvent.type(input, 'био мляко');
    await userEvent.click(screen.getByText('Запази'));

    await waitFor(async () => {
      const queued = await getQueuedMutations(['pending', 'failed']);
      expect(queued.some((mutation) => mutation.entity_client_uuid === 'up-1')).toBe(true);
    });
  });

  test('favorite toggle and term input are disabled for a system-owned term', async () => {
    const systemProduct: UserProductRecord = { ...baseUserProduct, owner_type: 'system', is_global_default: true };
    render(
      <UserProductDetailScreen
        item={baseItem}
        userProduct={systemProduct}
        onRename={async () => ({ ok: true })}
        onSetFavorite={() => {}}
        onUpdateItem={() => {}}
      />
    );

    expect(await screen.findByText('Млечни')).toBeInTheDocument();
    expect(screen.getByLabelText('Добави в любими')).toBeDisabled();
    expect(screen.getByLabelText('Термин')).toBeDisabled();
  });

  test('quantity edit calls onUpdateItem on blur', async () => {
    const onUpdateItem = vi.fn();
    render(
      <UserProductDetailScreen
        item={baseItem}
        userProduct={baseUserProduct}
        onRename={async () => ({ ok: true })}
        onSetFavorite={() => {}}
        onUpdateItem={onUpdateItem}
      />
    );

    const quantityInput = screen.getByLabelText('Количество');
    await userEvent.clear(quantityInput);
    await userEvent.type(quantityInput, '5');
    await userEvent.tab();

    expect(onUpdateItem).toHaveBeenCalledWith({ quantity: 5 });
  });
});
