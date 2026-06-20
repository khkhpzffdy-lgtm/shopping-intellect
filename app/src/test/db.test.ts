import { beforeEach, expect, test } from 'vitest';
import {
  clearDatabase,
  deleteList,
  enqueueMutation,
  getList,
  getListItems,
  getMutationStatusCounts,
  getStoreProductByClientUuid,
  mergeServerListItem,
  putList,
  putListItem,
  putStoreProduct
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

test('putStoreProduct/getStoreProductByClientUuid round-trips a record', async () => {
  await putStoreProduct({
    client_uuid: 'sp-1',
    id: '9',
    source: 'user',
    created_by_user_id: 7,
    name: 'Мляко Данон 2% 1л',
    image_url: 'https://example.com/p.jpg',
    created_at: '2026-06-18T00:00:00.000Z'
  });

  const found = await getStoreProductByClientUuid('sp-1');

  expect(found?.name).toBe('Мляко Данон 2% 1л');
  expect(found?.image_url).toBe('https://example.com/p.jpg');
  expect(found?.source).toBe('user');
});

test('getListItems resolves the name of a store-product-targeted item', async () => {
  await putList({
    client_uuid: 'list-y',
    id: '6',
    name: 'Y',
    owner_type: 'user',
    owner_id: 1,
    updated_at: '2026-06-18T00:00:00.000Z'
  });
  await putStoreProduct({
    client_uuid: 'sp-2',
    id: '10',
    source: 'user',
    created_by_user_id: 7,
    name: 'Мляко Данон 2% 1л',
    created_at: '2026-06-18T00:00:00.000Z'
  });
  await putListItem({
    client_uuid: 'item-y1',
    list_client_uuid: 'list-y',
    list_id: '6',
    store_product_client_uuid: 'sp-2',
    store_product_id: '10',
    quantity: 1,
    unit: 'piece',
    is_checked: false,
    created_at: '2026-06-18T00:00:00.000Z',
    updated_at: '2026-06-18T00:00:00.000Z'
  });

  const items = await getListItems('list-y');

  expect(items[0]?.term).toBe('Мляко Данон 2% 1л');
});

test('mergeServerListItem keys store_products by client_uuid, not the server numeric id', async () => {
  // Regression guard for a real production bug (2026-06-20): mergeServerListItem
  // used to db.put/db.get store_products keyed by the server's numeric
  // store_product_id instead of its real client_uuid. Since the IndexedDB
  // store_products object store's keyPath is client_uuid, two *different*
  // StoreProducts that happen to share the same numeric server id (e.g. two
  // different users' first manually-added item, both id=10) would collide and
  // silently overwrite each other locally — showing one user's item under the
  // other's name on the next merge.
  await putList({
    client_uuid: 'list-z',
    id: '7',
    name: 'Z',
    owner_type: 'user',
    owner_id: 1,
    updated_at: '2026-06-20T00:00:00.000Z'
  });

  await mergeServerListItem(
    {
      id: '50',
      client_uuid: 'item-z1',
      list_id: '7',
      user_product_id: null,
      store_product_id: '10',
      store_product_client_uuid: 'sp-real-uuid-1',
      quantity: 1,
      unit: 'piece',
      is_checked: false,
      updated_at: '2026-06-20T00:00:00.000Z',
      term: null,
      name: 'Мляко Олимпус 2% 1л'
    },
    'list-z'
  );

  await mergeServerListItem(
    {
      id: '51',
      client_uuid: 'item-z2',
      list_id: '7',
      user_product_id: null,
      store_product_id: '10',
      store_product_client_uuid: 'sp-real-uuid-2',
      quantity: 1,
      unit: 'piece',
      is_checked: false,
      updated_at: '2026-06-20T00:00:01.000Z',
      term: null,
      name: 'Dream'
    },
    'list-z'
  );

  const items = await getListItems('list-z');
  const firstItem = items.find((item) => item.client_uuid === 'item-z1');
  const secondItem = items.find((item) => item.client_uuid === 'item-z2');

  expect(firstItem?.term).toBe('Мляко Олимпус 2% 1л');
  expect(secondItem?.term).toBe('Dream');

  expect(await getStoreProductByClientUuid('sp-real-uuid-1')).toBeTruthy();
  expect(await getStoreProductByClientUuid('sp-real-uuid-2')).toBeTruthy();
});
