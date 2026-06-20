import { deleteDB, openDB } from 'idb';

export type SyncStatus = 'pending' | 'in_flight' | 'done' | 'failed';

export type ShoppingListRecord = {
  client_uuid: string;
  id?: string;
  name: string;
  owner_type: 'user';
  owner_id: number;
  updated_at: string;
};

export type UserProductRecord = {
  client_uuid: string;
  id?: string;
  owner_type: 'user' | 'system';
  owner_id: number;
  term: string;
  normalized_term: string;
  created_at: string;
  category_ids?: string[];
  is_global_default?: boolean;
};

export type StoreProductRecord = {
  client_uuid: string;
  id?: string;
  source: 'crawler' | 'user';
  created_by_user_id?: number;
  name: string;
  image_url?: string | null;
  created_at: string;
};

export type ListItemRecord = {
  client_uuid: string;
  id?: string;
  list_client_uuid: string;
  list_id?: string;
  user_product_client_uuid?: string;
  user_product_id?: string;
  store_product_client_uuid?: string;
  store_product_id?: string;
  quantity: number;
  unit: string;
  is_checked: boolean;
  created_at: string;
  updated_at: string;
};

export type MutationQueueRecord = {
  client_uuid: string;
  endpoint: string;
  method: 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  created_at: string;
  attempts: number;
  status: SyncStatus;
  entity_client_uuid: string;
};

export type ListItemView = ListItemRecord & {
  term: string;
};

const DB_NAME = 'si-db';
const DB_VERSION = 2;

const normalizeTerm = (term: string) => term.trim().toLocaleLowerCase('bg-BG');

let dbPromise: ReturnType<typeof openDB> | null = null;

const getDb = () => {
  dbPromise ??= openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('lists')) {
        db.createObjectStore('lists', { keyPath: 'client_uuid' });
      }
      if (!db.objectStoreNames.contains('list_items')) {
        db.createObjectStore('list_items', { keyPath: 'client_uuid' });
      }
      if (!db.objectStoreNames.contains('user_products')) {
        db.createObjectStore('user_products', { keyPath: 'client_uuid' });
      }
      if (!db.objectStoreNames.contains('store_products')) {
        db.createObjectStore('store_products', { keyPath: 'client_uuid' });
      }
      if (!db.objectStoreNames.contains('mutation_queue')) {
        db.createObjectStore('mutation_queue', { keyPath: 'client_uuid' });
      }
    },
    blocking() {
      // This connection is the older one blocking a newer tab/instance's
      // upgrade — close it so that tab can proceed instead of hanging.
      dbPromise?.then((db) => db.close());
      dbPromise = null;
    },
    blocked() {
      // A stale connection elsewhere (another tab/PWA instance on an older
      // schema version) is blocking this upgrade and openDB() would hang
      // silently forever otherwise. Reloading is the most reliable recovery.
      window.location.reload();
    }
  });

  return dbPromise;
};

export const getLists = async () => {
  const db = await getDb();
  return (await db.getAll('lists')).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
};

export const getList = async (listKey: string) => {
  const db = await getDb();
  const direct = await db.get('lists', listKey);
  if (direct) {
    return direct;
  }
  const lists = await db.getAll('lists');
  return lists.find((list) => list.id === listKey) ?? null;
};

export const putList = async (list: ShoppingListRecord) => {
  const db = await getDb();
  await db.put('lists', list);
};

export const deleteList = async (listKey: string) => {
  const db = await getDb();
  const list = await getList(listKey);
  const items = await db.getAll('list_items');
  await Promise.all(
    items
      .filter((item) => item.list_client_uuid === listKey || item.list_id === listKey)
      .map((item) => db.delete('list_items', item.client_uuid))
  );
  await db.delete('lists', list?.client_uuid ?? listKey);
};

export const touchListUpdatedAt = async (clientUuid: string, updatedAt: string) => {
  const db = await getDb();
  const current = await db.get('lists', clientUuid);
  if (!current) {
    return;
  }
  await db.put('lists', { ...current, updated_at: updatedAt });
};

export const getListItems = async (listKey: string): Promise<ListItemView[]> => {
  const db = await getDb();
  const items = await db.getAll('list_items');
  const userProducts = await db.getAll('user_products');
  const storeProducts = await db.getAll('store_products');

  return items
    .filter((item) => item.list_client_uuid === listKey || item.list_id === listKey)
    .map((item) => {
      const userProduct =
        userProducts.find((product) => product.client_uuid === item.user_product_client_uuid) ??
        userProducts.find((product) => product.id === item.user_product_id);

      const storeProduct =
        storeProducts.find((product) => product.client_uuid === item.store_product_client_uuid) ??
        storeProducts.find((product) => product.id === item.store_product_id);

      return {
        ...item,
        term: userProduct?.term ?? storeProduct?.name ?? 'Unknown item'
      };
    })
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
};

export const getListItemCounts = async () => {
  const db = await getDb();
  const items = await db.getAll('list_items');
  return items.reduce<Record<string, number>>((counts, item) => {
    counts[item.list_client_uuid] = (counts[item.list_client_uuid] ?? 0) + 1;
    return counts;
  }, {});
};

export const putListItem = async (item: ListItemRecord) => {
  const db = await getDb();
  await db.put('list_items', item);
};

export const deleteListItem = async (clientUuid: string) => {
  const db = await getDb();
  await db.delete('list_items', clientUuid);
};

export const getAllUserProducts = async (): Promise<UserProductRecord[]> => {
  const db = await getDb();
  return db.getAll('user_products');
};

export const getUserProductByTerm = async (term: string, ownerId: number) => {
  const db = await getDb();
  const normalizedTerm = normalizeTerm(term);
  const products = await db.getAll('user_products');
  return (
    products.find(
      (product) =>
        product.owner_id === ownerId &&
        (product.normalized_term === normalizedTerm || normalizeTerm(product.term) === normalizedTerm)
    ) ?? null
  );
};

export const putUserProduct = async (userProduct: UserProductRecord) => {
  const db = await getDb();
  await db.put('user_products', userProduct);
};

export const getUserProduct = async (clientUuid: string) => {
  const db = await getDb();
  return db.get('user_products', clientUuid);
};

export const putStoreProduct = async (storeProduct: StoreProductRecord) => {
  const db = await getDb();
  await db.put('store_products', storeProduct);
};

export const getStoreProductByClientUuid = async (clientUuid: string) => {
  const db = await getDb();
  return db.get('store_products', clientUuid);
};

export const enqueueMutation = async (mutation: MutationQueueRecord) => {
  const db = await getDb();
  await db.put('mutation_queue', mutation);
};

export const getMutation = async (clientUuid: string) => {
  const db = await getDb();
  return db.get('mutation_queue', clientUuid);
};

export const getQueuedMutations = async (statuses: SyncStatus[] = ['pending', 'failed']) => {
  const db = await getDb();
  const queued = await db.getAll('mutation_queue');
  return queued
    .filter((mutation) => statuses.includes(mutation.status))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
};

export const getMutationStatusCounts = async (): Promise<Record<string, { pending: number; failed: number }>> => {
  const db = await getDb();
  const mutations = await db.getAll('mutation_queue');
  return mutations.reduce<Record<string, { pending: number; failed: number }>>((counts, mutation) => {
    if (mutation.status !== 'pending' && mutation.status !== 'in_flight' && mutation.status !== 'failed') {
      return counts;
    }

    const entry = counts[mutation.entity_client_uuid] ?? { pending: 0, failed: 0 };
    if (mutation.status === 'failed') {
      entry.failed += 1;
    } else {
      entry.pending += 1;
    }
    counts[mutation.entity_client_uuid] = entry;
    return counts;
  }, {});
};

export const markMutationDone = async (clientUuid: string) => {
  const db = await getDb();
  await db.delete('mutation_queue', clientUuid);
};

export const markMutationInFlight = async (clientUuid: string) => {
  const db = await getDb();
  const mutation = await db.get('mutation_queue', clientUuid);
  if (!mutation) {
    return null;
  }

  const updatedMutation = { ...mutation, status: 'in_flight' as const };
  await db.put('mutation_queue', updatedMutation);
  return updatedMutation;
};

export const markMutationFailed = async (clientUuid: string) => {
  const db = await getDb();
  const mutation = await db.get('mutation_queue', clientUuid);
  if (!mutation) {
    return null;
  }

  const updatedMutation = {
    ...mutation,
    attempts: mutation.attempts + 1,
    status: 'failed' as const
  };
  await db.put('mutation_queue', updatedMutation);
  return updatedMutation;
};

export const updateMutationBody = async (clientUuid: string, body: unknown) => {
  const db = await getDb();
  const mutation = await db.get('mutation_queue', clientUuid);
  if (!mutation) {
    return;
  }
  await db.put('mutation_queue', { ...mutation, body });
};

export const removeQueuedMutationsForEntity = async (entityClientUuid: string) => {
  const db = await getDb();
  const mutations = await db.getAll('mutation_queue');
  await Promise.all(
    mutations
      .filter((mutation) => mutation.entity_client_uuid === entityClientUuid)
      .map((mutation) => db.delete('mutation_queue', mutation.client_uuid))
  );
};

export const clearDatabase = async () => {
  await deleteDB(DB_NAME);
};

export const getListItem = async (clientUuid: string) => {
  const db = await getDb();
  return db.get('list_items', clientUuid);
};

const hasQueuedMutation = async (entityClientUuid: string) => {
  const queued = await getQueuedMutations(['pending', 'in_flight', 'failed']);
  return queued.some((mutation) => mutation.entity_client_uuid === entityClientUuid);
};

export const mergeServerList = async (serverList: {
  client_uuid: string;
  id: string;
  name: string;
  owner_type: 'user';
  owner_id: string;
  updated_at: string;
}) => {
  if (await hasQueuedMutation(serverList.client_uuid)) {
    return;
  }

  const db = await getDb();
  const local = await db.get('lists', serverList.client_uuid);

  if (local && local.updated_at >= serverList.updated_at) {
    return;
  }

  await db.put('lists', {
    client_uuid: serverList.client_uuid,
    id: serverList.id,
    name: serverList.name,
    owner_type: serverList.owner_type,
    owner_id: Number(serverList.owner_id),
    updated_at: serverList.updated_at
  });
};

export const mergeServerListItem = async (
  serverItem: {
    client_uuid: string;
    id: string;
    list_id: string;
    user_product_id: string | null;
    user_product_client_uuid?: string | null;
    store_product_id?: string | null;
    store_product_client_uuid?: string | null;
    quantity: number;
    unit: string;
    is_checked: boolean;
    updated_at: string;
    term: string | null;
    name?: string | null;
  },
  listClientUuid: string
) => {
  if (await hasQueuedMutation(serverItem.client_uuid)) {
    return;
  }

  const db = await getDb();
  const local = await db.get('list_items', serverItem.client_uuid);

  if (local && local.updated_at >= serverItem.updated_at) {
    return;
  }

  if (serverItem.term && serverItem.user_product_client_uuid) {
    const existingProduct = await db.get('user_products', serverItem.user_product_client_uuid);
    if (!existingProduct) {
      await db.put('user_products', {
        client_uuid: serverItem.user_product_client_uuid,
        id: serverItem.user_product_id ?? undefined,
        owner_type: 'user',
        owner_id: 0,
        term: serverItem.term,
        normalized_term: normalizeTerm(serverItem.term),
        created_at: serverItem.updated_at
      });
    }
  }

  if (serverItem.name && serverItem.store_product_client_uuid) {
    const existingProduct = await db.get('store_products', serverItem.store_product_client_uuid);
    if (!existingProduct) {
      await db.put('store_products', {
        client_uuid: serverItem.store_product_client_uuid,
        id: serverItem.store_product_id ?? undefined,
        source: 'user',
        name: serverItem.name,
        created_at: serverItem.updated_at
      });
    }
  }

  await db.put('list_items', {
    client_uuid: serverItem.client_uuid,
    id: serverItem.id,
    list_client_uuid: listClientUuid,
    list_id: serverItem.list_id,
    user_product_client_uuid: serverItem.user_product_client_uuid ?? undefined,
    user_product_id: serverItem.user_product_id ?? undefined,
    store_product_client_uuid: serverItem.store_product_client_uuid ?? undefined,
    store_product_id: serverItem.store_product_id ?? undefined,
    quantity: serverItem.quantity,
    unit: serverItem.unit,
    is_checked: serverItem.is_checked,
    created_at: local?.created_at ?? serverItem.updated_at,
    updated_at: serverItem.updated_at
  });
};
