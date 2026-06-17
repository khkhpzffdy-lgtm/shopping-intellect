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
  owner_type: 'user';
  owner_id: number;
  term: string;
  normalized_term: string;
  created_at: string;
};

export type ListItemRecord = {
  client_uuid: string;
  id?: string;
  list_client_uuid: string;
  list_id?: string;
  user_product_client_uuid: string;
  user_product_id?: string;
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
const DB_VERSION = 1;

const normalizeTerm = (term: string) => term.trim().toLocaleLowerCase('bg-BG');

const getDb = () =>
  openDB(DB_NAME, DB_VERSION, {
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
      if (!db.objectStoreNames.contains('mutation_queue')) {
        db.createObjectStore('mutation_queue', { keyPath: 'client_uuid' });
      }
    }
  });

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

  return items
    .filter((item) => item.list_client_uuid === listKey || item.list_id === listKey)
    .map((item) => {
      const userProduct =
        userProducts.find((product) => product.client_uuid === item.user_product_client_uuid) ??
        userProducts.find((product) => product.id === item.user_product_id);

      return {
        ...item,
        term: userProduct?.term ?? 'Unknown item'
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

export const getPendingMutationCounts = async () => {
  const db = await getDb();
  const mutations = await db.getAll('mutation_queue');
  return mutations.reduce<Record<string, number>>((counts, mutation) => {
    if (
      mutation.status === 'pending' ||
      mutation.status === 'in_flight' ||
      mutation.status === 'failed'
    ) {
      counts[mutation.entity_client_uuid] = (counts[mutation.entity_client_uuid] ?? 0) + 1;
    }
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
