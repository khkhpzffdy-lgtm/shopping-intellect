import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { StoreProductDetailScreen } from '../components/StoreProductDetailScreen';
import { apiRequest } from '../api/client';
import {
  clearDatabase,
  enqueueMutation,
  getQueuedMutations,
  getStoreProductByClientUuid,
  putStoreProduct,
  type ListItemView,
  type StoreProductRecord
} from '../storage/db';

vi.mock('../api/client', () => ({
  apiRequest: vi.fn()
}));

const mockedApiRequest = vi.mocked(apiRequest);

const baseStoreProduct: StoreProductRecord = {
  client_uuid: 'sp-1',
  id: '77',
  source: 'user',
  created_by_user_id: 7,
  name: 'Мляко',
  image_url: null,
  created_at: '2026-06-21T09:00:00.000Z'
};

const baseItem: ListItemView = {
  client_uuid: 'item-1',
  id: '900',
  list_client_uuid: 'list-1',
  list_id: '42',
  store_product_client_uuid: 'sp-1',
  store_product_id: '77',
  quantity: 1,
  unit: 'бр.',
  is_checked: false,
  created_at: '2026-06-21T09:00:00.000Z',
  updated_at: '2026-06-21T09:00:00.000Z',
  term: 'Мляко'
};

// Minimal stand-ins for HomeScreen's real handlers — exercise the same real
// IndexedDB write + mutation enqueue the production handlers do, so these
// tests prove the component's contract actually persists.
const renameViaRealPersistence = async (storeProduct: StoreProductRecord, newName: string) => {
  const trimmed = newName.trim();
  if (!trimmed || trimmed === storeProduct.name) {
    return { ok: true };
  }

  const updated = { ...storeProduct, name: trimmed };
  await putStoreProduct(updated);

  await enqueueMutation({
    client_uuid: 'mutation-rename',
    endpoint: `/store-products/${storeProduct.id}`,
    method: 'PATCH',
    body: { name: trimmed },
    created_at: new Date().toISOString(),
    attempts: 0,
    status: 'pending',
    entity_client_uuid: storeProduct.client_uuid
  });

  try {
    await apiRequest(`/store-products/${storeProduct.id}`, {
      method: 'PATCH',
      body: { name: trimmed },
      authenticated: true
    });
  } catch {
    // Offline — local write and queued mutation already happened above.
  }

  return { ok: true };
};

const setBarcodeViaRealPersistence = async (storeProduct: StoreProductRecord, barcodeValue: string) => {
  const updated = { ...storeProduct, barcode: barcodeValue };
  await putStoreProduct(updated);

  await enqueueMutation({
    client_uuid: 'mutation-barcode',
    endpoint: `/store-products/${storeProduct.id}`,
    method: 'PATCH',
    body: { barcode_value: barcodeValue },
    created_at: new Date().toISOString(),
    attempts: 0,
    status: 'pending',
    entity_client_uuid: storeProduct.client_uuid
  });

  try {
    await apiRequest(`/store-products/${storeProduct.id}`, {
      method: 'PATCH',
      body: { barcode_value: barcodeValue },
      authenticated: true
    });
  } catch {
    // Offline — local write and queued mutation already happened above.
  }
};

beforeEach(async () => {
  mockedApiRequest.mockReset();
  await clearDatabase();
  mockedApiRequest.mockResolvedValue({});
});

describe('StoreProductDetailScreen', () => {
  test('renders name, photo, and barcode fields', () => {
    render(
      <StoreProductDetailScreen
        item={baseItem}
        storeProduct={baseStoreProduct}
        canEdit
        onRename={async () => ({ ok: true })}
        onSetImageUrl={() => {}}
        onSetBarcode={() => {}}
      />
    );

    expect(screen.getByLabelText('Име')).toHaveValue('Мляко');
    expect(screen.getByLabelText('Снимка (URL)')).toHaveValue('');
    expect(screen.getByLabelText('Баркод')).toHaveValue('');
  });

  test('blank rename is a no-op (reverts to the current name, no onRename call)', async () => {
    const onRename = vi.fn(async () => ({ ok: true }));
    render(
      <StoreProductDetailScreen
        item={baseItem}
        storeProduct={baseStoreProduct}
        canEdit
        onRename={onRename}
        onSetImageUrl={() => {}}
        onSetBarcode={() => {}}
      />
    );

    const input = screen.getByLabelText('Име');
    await userEvent.clear(input);
    await userEvent.tab();

    expect(onRename).not.toHaveBeenCalled();
    expect(input).toHaveValue('Мляко');
  });

  test('rename persists to IndexedDB on blur', async () => {
    await putStoreProduct(baseStoreProduct);

    render(
      <StoreProductDetailScreen
        item={baseItem}
        storeProduct={baseStoreProduct}
        canEdit
        onRename={(newName) => renameViaRealPersistence(baseStoreProduct, newName)}
        onSetImageUrl={() => {}}
        onSetBarcode={() => {}}
      />
    );

    const input = screen.getByLabelText('Име');
    await userEvent.clear(input);
    await userEvent.type(input, 'Мляко Данон 2% 1л');
    await userEvent.tab();

    await waitFor(async () => {
      const stored = await getStoreProductByClientUuid('sp-1');
      expect(stored?.name).toBe('Мляко Данон 2% 1л');
    });
  });

  test('offline rename still persists locally and queues a mutation', async () => {
    await putStoreProduct(baseStoreProduct);
    mockedApiRequest.mockRejectedValueOnce(new Error('Network error'));

    render(
      <StoreProductDetailScreen
        item={baseItem}
        storeProduct={baseStoreProduct}
        canEdit
        onRename={(newName) => renameViaRealPersistence(baseStoreProduct, newName)}
        onSetImageUrl={() => {}}
        onSetBarcode={() => {}}
      />
    );

    const input = screen.getByLabelText('Име');
    await userEvent.clear(input);
    await userEvent.type(input, 'Био мляко');
    await userEvent.tab();

    await waitFor(async () => {
      const queued = await getQueuedMutations(['pending', 'failed']);
      expect(queued.some((mutation) => mutation.entity_client_uuid === 'sp-1')).toBe(true);
    });
  });

  test('setting a barcode persists to IndexedDB on blur', async () => {
    await putStoreProduct(baseStoreProduct);

    render(
      <StoreProductDetailScreen
        item={baseItem}
        storeProduct={baseStoreProduct}
        canEdit
        onRename={async () => ({ ok: true })}
        onSetImageUrl={() => {}}
        onSetBarcode={(barcodeValue) => void setBarcodeViaRealPersistence(baseStoreProduct, barcodeValue)}
      />
    );

    const input = screen.getByLabelText('Баркод');
    await userEvent.type(input, '1234567890123');
    await userEvent.tab();

    await waitFor(async () => {
      const stored = await getStoreProductByClientUuid('sp-1');
      expect(stored?.barcode).toBe('1234567890123');
    });
  });

  test('name, photo, and barcode are disabled for a crawler-sourced product, with a note shown only for source=user', () => {
    const crawlerProduct: StoreProductRecord = { ...baseStoreProduct, source: 'crawler' };
    render(
      <StoreProductDetailScreen
        item={baseItem}
        storeProduct={crawlerProduct}
        canEdit
        onRename={async () => ({ ok: true })}
        onSetImageUrl={() => {}}
        onSetBarcode={() => {}}
      />
    );

    expect(screen.getByLabelText('Име')).toBeDisabled();
    expect(screen.getByLabelText('Снимка (URL)')).toBeDisabled();
    expect(screen.getByLabelText('Баркод')).toBeDisabled();
    expect(screen.queryByText('ръчно записан артикул, още не е намерен в магазин')).not.toBeInTheDocument();
  });

  test('shows the manually-recorded note for a source=user product', () => {
    render(
      <StoreProductDetailScreen
        item={baseItem}
        storeProduct={baseStoreProduct}
        canEdit
        onRename={async () => ({ ok: true })}
        onSetImageUrl={() => {}}
        onSetBarcode={() => {}}
      />
    );

    expect(screen.getByText('ръчно записан артикул, още не е намерен в магазин')).toBeInTheDocument();
  });

  test('fields are disabled for a non-creator, with a distinct note', () => {
    render(
      <StoreProductDetailScreen
        item={baseItem}
        storeProduct={baseStoreProduct}
        canEdit={false}
        onRename={async () => ({ ok: true })}
        onSetImageUrl={() => {}}
        onSetBarcode={() => {}}
      />
    );

    expect(screen.getByLabelText('Име')).toBeDisabled();
    expect(screen.getByText('само създателят на този артикул може да го редактира')).toBeInTheDocument();
  });
});
