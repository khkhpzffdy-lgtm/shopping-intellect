import { openDB } from 'idb';
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

test('upgrading from DB_VERSION 2 deletes pre-existing rows with a corrupt numeric client_uuid', async () => {
  // Regression guard for the real-world fallout of the "Dream" bug: by the
  // time the keying fix (above test) shipped, phones that had already hit
  // the bug were carrying a genuinely corrupt row on disk — a store_products
  // row keyed by a server numeric id (e.g. "10") instead of a real UUID.
  // Shipping the keying fix alone does NOT repair that pre-existing row; the
  // DB_VERSION 3 upgrade step has to actively find and drop it so the next
  // server-pull-on-boot can recreate it correctly under its real client_uuid.
  await clearDatabase();

  const legacyDb = await openDB('si-db', 2, {
    upgrade(db) {
      db.createObjectStore('lists', { keyPath: 'client_uuid' });
      db.createObjectStore('list_items', { keyPath: 'client_uuid' });
      db.createObjectStore('user_products', { keyPath: 'client_uuid' });
      db.createObjectStore('store_products', { keyPath: 'client_uuid' });
      db.createObjectStore('mutation_queue', { keyPath: 'client_uuid' });
    }
  });

  await legacyDb.put('store_products', {
    client_uuid: '10',
    id: '10',
    source: 'user',
    name: 'Dream',
    created_at: '2026-06-20T00:00:00.000Z'
  });
  await legacyDb.put('store_products', {
    client_uuid: 'sp-real-uuid-untouched',
    id: '11',
    source: 'user',
    name: 'Real item',
    created_at: '2026-06-20T00:00:00.000Z'
  });
  await legacyDb.put('user_products', {
    client_uuid: '7',
    id: '7',
    owner_type: 'user',
    owner_id: 1,
    term: 'corrupt legacy term',
    normalized_term: 'corrupt legacy term',
    created_at: '2026-06-20T00:00:00.000Z'
  });
  legacyDb.close();

  // Triggers getDb(), which opens at the current DB_VERSION (3) and runs the
  // cleanup step in upgrade() against the version-2 data written above.
  const corruptRow = await getStoreProductByClientUuid('10');
  const untouchedRow = await getStoreProductByClientUuid('sp-real-uuid-untouched');

  expect(corruptRow).toBeFalsy();
  expect(untouchedRow).toBeTruthy();
  expect(untouchedRow?.name).toBe('Real item');
});
