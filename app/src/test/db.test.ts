import { beforeEach, expect, test } from 'vitest';
import {
  clearDatabase,
  deleteList,
  enqueueMutation,
  getList,
  getListItems,
  getMutationStatusCounts,
  putList,
  putListItem
} from '../storage/db';

beforeEach(async () => {
  await clearDatabase();
});

test('deleteList removes the list and its local item rows', async () => {
  await putList({
    client_uuid: 'list-x',
    id: '5',
    name: 'X',
    owner_type: 'user',
    owner_id: 1,
    updated_at: '2026-06-18T00:00:00.000Z'
  });
  await putListItem({
    client_uuid: 'item-x1',
    list_client_uuid: 'list-x',
    list_id: '5',
    user_product_client_uuid: 'up-x1',
    user_product_id: '7',
    quantity: 1,
    unit: 'piece',
    is_checked: false,
    created_at: '2026-06-18T00:00:00.000Z',
    updated_at: '2026-06-18T00:00:00.000Z'
  });

  await deleteList('list-x');

  expect(await getList('list-x')).toBeFalsy();
  expect(await getListItems('list-x')).toEqual([]);
});

test('getMutationStatusCounts produces independent pending/failed counts per entity', async () => {
  await enqueueMutation({
    client_uuid: 'mut-pending',
    endpoint: '/lists',
    method: 'POST',
    created_at: '2026-06-17T00:00:00.000Z',
    attempts: 0,
    status: 'pending',
    entity_client_uuid: 'entity-a'
  });
  await enqueueMutation({
    client_uuid: 'mut-failed',
    endpoint: '/lists',
    method: 'POST',
    created_at: '2026-06-17T00:00:00.000Z',
    attempts: 1,
    status: 'failed',
    entity_client_uuid: 'entity-b'
  });

  const counts = await getMutationStatusCounts();

  expect(counts['entity-a']).toEqual({ pending: 1, failed: 0 });
  expect(counts['entity-b']).toEqual({ pending: 0, failed: 1 });
});
