import { beforeEach, describe, expect, test, vi } from 'vitest';
import { apiRequest } from '../api/client';
import {
  clearDatabase,
  enqueueMutation,
  getList,
  getListItem,
  getMutation,
  getUserProduct,
  putList,
  putListItem,
  putUserProduct
} from '../storage/db';
import { flushQueuedMutations } from '../sync/flush';

vi.mock('../api/client', () => ({
  apiRequest: vi.fn()
}));

const mockedApiRequest = vi.mocked(apiRequest);

describe('flushQueuedMutations', () => {
  beforeEach(async () => {
    mockedApiRequest.mockReset();
    await clearDatabase();
  });

  test('replays queued create-list and create-item mutations in order and writes back server ids', async () => {
    await putList({
      client_uuid: 'list-local-1',
      name: 'Weekend',
      owner_type: 'user',
      owner_id: 7,
      updated_at: '2026-06-15T10:00:00.000Z'
    });
    await putUserProduct({
      client_uuid: 'product-local-1',
      owner_type: 'user',
      owner_id: 7,
      term: 'мляко',
      normalized_term: 'мляко',
      created_at: '2026-06-15T10:01:00.000Z'
    });
    await putListItem({
      client_uuid: 'item-local-1',
      list_client_uuid: 'list-local-1',
      user_product_client_uuid: 'product-local-1',
      quantity: 2,
      unit: 'piece',
      is_checked: false,
      created_at: '2026-06-15T10:02:00.000Z',
      updated_at: '2026-06-15T10:02:00.000Z'
    });
    await enqueueMutation({
      client_uuid: 'list-local-1',
      endpoint: '/lists',
      method: 'POST',
      body: {
        client_uuid: 'list-local-1',
        name: 'Weekend',
        owner_type: 'user',
        owner_id: 7
      },
      created_at: '2026-06-15T10:00:00.000Z',
      attempts: 0,
      status: 'pending',
      entity_client_uuid: 'list-local-1'
    });
    await enqueueMutation({
      client_uuid: 'item-local-1',
      endpoint: '/lists/list-local-1/items',
      method: 'POST',
      body: {
        client_uuid: 'item-local-1',
        quantity: 2,
        unit: 'piece',
        is_checked: false,
        user_product: {
          client_uuid: 'product-local-1',
          term: 'мляко'
        }
      },
      created_at: '2026-06-15T10:02:00.000Z',
      attempts: 0,
      status: 'pending',
      entity_client_uuid: 'item-local-1'
    });

    mockedApiRequest
      .mockResolvedValueOnce({ list: { id: 'srv-list-1' } })
      .mockResolvedValueOnce({
        item: { id: 'srv-item-1', is_checked: false },
        user_product: { id: 'srv-product-1' }
      });

    await flushQueuedMutations();

    expect(mockedApiRequest).toHaveBeenNthCalledWith(
      1,
      '/lists',
      expect.objectContaining({ method: 'POST', authenticated: true })
    );
    expect(mockedApiRequest).toHaveBeenNthCalledWith(
      2,
      '/lists/srv-list-1/items',
      expect.objectContaining({ method: 'POST', authenticated: true })
    );
    expect(await getMutation('list-local-1')).toBeUndefined();
    expect(await getMutation('item-local-1')).toBeUndefined();
    expect((await getList('list-local-1'))?.id).toBe('srv-list-1');
    expect((await getListItem('item-local-1'))?.id).toBe('srv-item-1');
    expect((await getUserProduct('product-local-1'))?.id).toBe('srv-product-1');
  });

  test('failed mutations stay queued and flip to failed with incremented attempts', async () => {
    await putList({
      client_uuid: 'list-local-2',
      name: 'Errands',
      owner_type: 'user',
      owner_id: 8,
      updated_at: '2026-06-15T11:00:00.000Z'
    });
    await enqueueMutation({
      client_uuid: 'list-local-2',
      endpoint: '/lists',
      method: 'POST',
      body: {
        client_uuid: 'list-local-2',
        name: 'Errands',
        owner_type: 'user',
        owner_id: 8
      },
      created_at: '2026-06-15T11:00:00.000Z',
      attempts: 0,
      status: 'pending',
      entity_client_uuid: 'list-local-2'
    });

    mockedApiRequest.mockRejectedValueOnce(new Error('offline'));

    await flushQueuedMutations();

    await expect(getMutation('list-local-2')).resolves.toMatchObject({
      attempts: 1,
      status: 'failed'
    });
  });

  test('coalesces concurrent drains so an in-flight mutation is only sent once', async () => {
    await putList({
      client_uuid: 'list-local-3',
      name: 'Bakery',
      owner_type: 'user',
      owner_id: 9,
      updated_at: '2026-06-15T12:00:00.000Z'
    });
    await enqueueMutation({
      client_uuid: 'list-local-3',
      endpoint: '/lists',
      method: 'POST',
      body: {
        client_uuid: 'list-local-3',
        name: 'Bakery',
        owner_type: 'user',
        owner_id: 9
      },
      created_at: '2026-06-15T12:00:00.000Z',
      attempts: 0,
      status: 'pending',
      entity_client_uuid: 'list-local-3'
    });

    const deferred: { resolve?: (value: { list: { id: string } }) => void } = {};
    mockedApiRequest.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          deferred.resolve = resolve;
        })
    );

    const firstDrain = flushQueuedMutations();
    await Promise.resolve();
    const secondDrain = flushQueuedMutations();

    expect(mockedApiRequest).toHaveBeenCalledTimes(1);
    await expect(getMutation('list-local-3')).resolves.toMatchObject({
      status: 'in_flight'
    });

    deferred.resolve?.({ list: { id: 'srv-list-3' } });
    await Promise.all([firstDrain, secondDrain]);

    expect(mockedApiRequest).toHaveBeenCalledTimes(1);
    expect(await getMutation('list-local-3')).toBeUndefined();
  });
});
