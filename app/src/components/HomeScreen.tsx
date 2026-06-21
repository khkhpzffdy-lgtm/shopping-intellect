import { ApiError, apiRequest, fetchListWithItems, fetchLists, logout } from '../api/client';
import { clearScheduledRefresh } from '../api/session';
import { flushQueuedMutations } from '../sync/flush';
import { sendMutation } from '../sync/sendMutation';
import { useAuthStore } from '../store/auth';
import { useThemeStore } from '../store/theme';
import {
  clearSyncedData,
  deleteList,
  deleteListItem,
  enqueueMutation,
  getListItems,
  getListItemCounts,
  getLists,
  getMutationStatusCounts,
  getQueuedMutations,
  getUserProduct,
  getUserProductByTerm,
  markMutationInFlight,
  mergeServerList,
  mergeServerListItem,
  putList,
  putListItem,
  putUserProduct,
  removeQueuedMutationsForEntity,
  touchListUpdatedAt,
  updateMutationBody,
  type ListItemView,
  type ShoppingListRecord,
  type UserProductRecord
} from '../storage/db';
import { AddSearchScreen } from './AddSearchScreen';
import { ListsScreen } from './ListsScreen';
import { ListScreen } from './ListScreen';
import { UserProductDetailScreen } from './UserProductDetailScreen';
import { useEffect, useMemo, useRef, useState } from 'react';
import { generateUuid } from '../utils/uuid';

const formatActionError = (error: unknown, fallback: string) => {
  if (error instanceof ApiError) {
    const detailMessage = error.details
      ? Object.entries(error.details)
          .map(([key, value]) => `${key}: ${value}`)
          .join(', ')
      : null;

    if (detailMessage) {
      return `${fallback} (${detailMessage})`;
    }

    return error.code ? `${fallback} (${error.code})` : `${fallback} (${error.message})`;
  }

  if (error instanceof Error && error.message) {
    return `${fallback} (${error.message})`;
  }

  return fallback;
};

export const HomeScreen = () => {
  const user = useAuthStore((state) => state.user);
  const theme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);
  const [lists, setLists] = useState<ShoppingListRecord[]>([]);
  const [selectedListKey, setSelectedListKey] = useState<string | null>(null);
  const [items, setItems] = useState<ListItemView[]>([]);
  const [mutationStatusCounts, setMutationStatusCounts] = useState<Record<string, { pending: number; failed: number }>>({});
  const [itemCounts, setItemCounts] = useState<Record<string, number>>({});
  const [createName, setCreateName] = useState('');
  const [draft, setDraft] = useState({ term: '', quantity: '', unit: '' });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [addSearchOpen, setAddSearchOpen] = useState(false);
  const [itemDetailKey, setItemDetailKey] = useState<string | null>(null);
  const [detailUserProduct, setDetailUserProduct] = useState<UserProductRecord | null>(null);
  const selectedListKeyRef = useRef<string | null>(null);

  selectedListKeyRef.current = selectedListKey;

  const selectedList = useMemo(
    () => lists.find((list) => list.client_uuid === selectedListKey || list.id === selectedListKey) ?? null,
    [lists, selectedListKey]
  );

  const itemDetailItem = useMemo(
    () => items.find((candidate) => candidate.client_uuid === itemDetailKey) ?? null,
    [items, itemDetailKey]
  );

  const refreshMutationStatusCounts = async () => {
    setMutationStatusCounts(await getMutationStatusCounts());
  };

  const refreshLists = async () => {
    setLists(await getLists());
    setItemCounts(await getListItemCounts());
    await refreshMutationStatusCounts();
  };

  const refreshItems = async (listKey: string) => {
    setItems(await getListItems(listKey));
    setItemCounts(await getListItemCounts());
    await refreshMutationStatusCounts();
  };

  useEffect(() => {
    if (!user) {
      return;
    }

    let isActive = true;

    // Full hard sync, run on every boot and every 'online' transition while
    // logged in — required for shared/family lists: a stale local copy of a
    // list another family member just edited must never linger. Order
    // matters: only clear+refetch once every queued mutation has actually
    // reached the server, so an offline-made edit is never silently dropped
    // by being overwritten with a now-stale server response.
    const runFullHardSync = async () => {
      try {
        const flushResult = await flushQueuedMutations();

        if (!isActive) {
          return;
        }

        if (flushResult.failed > 0) {
          // Something is still unsynced (offline, or the server rejected it)
          // — keep showing local-first data rather than risk deleting an
          // edit that hasn't actually reached the server yet (07 §3.3).
          await refreshLists();
          const listKey = selectedListKeyRef.current;
          if (listKey) {
            await refreshItems(listKey);
          }
          return;
        }

        const { lists: serverLists } = await fetchLists();

        if (!isActive) {
          return;
        }

        await clearSyncedData();

        await Promise.all(serverLists.map((serverList) => mergeServerList(serverList)));

        await Promise.all(
          serverLists.map(async (serverList) => {
            const { items: serverItems } = await fetchListWithItems(serverList.id);
            await Promise.all(
              serverItems.map((serverItem) => mergeServerListItem(serverItem, serverList.client_uuid))
            );
          })
        );

        if (!isActive) {
          return;
        }

        await refreshLists();
        const listKey = selectedListKeyRef.current;
        if (listKey) {
          await refreshItems(listKey);
        }
      } catch {
        // Offline boot or network failure — keep showing whatever local data
        // survived (07 §3.3). Nothing was cleared, since clearSyncedData()
        // only runs after fetchLists() above has already succeeded.
        if (!isActive) {
          return;
        }
        await refreshLists();
        const listKey = selectedListKeyRef.current;
        if (listKey) {
          await refreshItems(listKey);
        }
      }
    };

    void runFullHardSync();

    const handleOnline = () => {
      void runFullHardSync();
    };

    window.addEventListener('online', handleOnline);

    return () => {
      isActive = false;
      window.removeEventListener('online', handleOnline);
    };
  }, [user]);

  useEffect(() => {
    if (!selectedListKey) {
      return;
    }

    void refreshItems(selectedListKey);
  }, [selectedListKey]);

  const handleLogout = async () => {
    try {
      await logout();
    } finally {
      clearScheduledRefresh();
      useAuthStore.getState().clearSession();
    }
  };

  const handleCreateList = async () => {
    if (!user || !createName.trim()) {
      return;
    }

    try {
      setErrorMessage(null);
      const now = new Date().toISOString();
      const clientUuid = generateUuid();
      const optimisticList: ShoppingListRecord = {
        client_uuid: clientUuid,
        name: createName.trim(),
        owner_type: 'user',
        owner_id: user.id,
        updated_at: now
      };

      setCreateName('');
      await putList(optimisticList);
      await enqueueMutation({
        client_uuid: clientUuid,
        endpoint: '/lists',
        method: 'POST',
        body: {
          name: optimisticList.name,
          owner_type: 'user',
          owner_id: user.id,
          client_uuid: clientUuid
        },
        created_at: now,
        attempts: 0,
        status: 'pending',
        entity_client_uuid: clientUuid
      });
      await refreshLists();

      try {
        const claimedMutation = await markMutationInFlight(clientUuid);
        if (claimedMutation) {
          await sendMutation(claimedMutation);
        }
        await refreshLists();
      } catch {
        // Keep local optimistic state and the pending mutation — it will sync later.
      }
    } catch (error) {
      setErrorMessage(
        formatActionError(error, 'Списъкът не може да се създаде на това устройство все още. Опитай отново.')
      );
    }
  };

  const handleAddItem = async () => {
    if (!user || !selectedList || !draft.term.trim()) {
      return;
    }

    try {
      setErrorMessage(null);
      const now = new Date().toISOString();
      const product =
        (await getUserProductByTerm(draft.term, user.id)) ??
        {
          client_uuid: generateUuid(),
          owner_type: 'user' as const,
          owner_id: user.id,
          term: draft.term.trim(),
          normalized_term: draft.term.trim().toLocaleLowerCase('bg-BG'),
          created_at: now
        };

      await putUserProduct(product);

      const itemClientUuid = generateUuid();
      const optimisticItem = {
        client_uuid: itemClientUuid,
        list_client_uuid: selectedList.client_uuid,
        list_id: selectedList.id,
        user_product_client_uuid: product.client_uuid,
        user_product_id: product.id,
        quantity: Number(draft.quantity || '1'),
        unit: draft.unit.trim() || 'piece',
        is_checked: false,
        created_at: now,
        updated_at: now
      };

      await putListItem(optimisticItem);
      await touchListUpdatedAt(selectedList.client_uuid, now);
      await enqueueMutation({
        client_uuid: itemClientUuid,
        endpoint: selectedList.id ? `/lists/${selectedList.id}/items` : `/lists/${selectedList.client_uuid}/items`,
        method: 'POST',
        body: {
          client_uuid: itemClientUuid,
          quantity: optimisticItem.quantity,
          unit: optimisticItem.unit,
          is_checked: optimisticItem.is_checked,
          user_product: {
            client_uuid: product.client_uuid,
            term: product.term
          }
        },
        created_at: now,
        attempts: 0,
        status: 'pending',
        entity_client_uuid: itemClientUuid
      });
      setDraft({ term: '', quantity: '', unit: '' });
      await refreshLists();
      await refreshItems(selectedList.client_uuid);

      try {
        const claimedMutation = await markMutationInFlight(itemClientUuid);
        if (claimedMutation) {
          await sendMutation(claimedMutation);
        }
        await refreshItems(selectedList.client_uuid);
      } catch {
        // Keep local optimistic state and the pending mutation — it will sync later.
      }
    } catch (error) {
      setErrorMessage(
        formatActionError(error, 'Продуктът не може да се добави на това устройство все още. Опитай отново.')
      );
    }
  };

  const handleUpdateItem = async (
    item: ListItemView,
    patch: { is_checked?: boolean; quantity?: number; unit?: string }
  ) => {
    if (!selectedList) {
      return;
    }

    const updatedItem = {
      ...item,
      ...patch,
      updated_at: new Date().toISOString()
    };

    await putListItem(updatedItem);

    if (!item.id || !selectedList.id) {
      const body = {
        client_uuid: item.client_uuid,
        quantity: updatedItem.quantity,
        unit: updatedItem.unit,
        is_checked: updatedItem.is_checked,
        user_product: {
          client_uuid: item.user_product_client_uuid,
          term: item.term
        }
      };
      await updateMutationBody(item.client_uuid, body);
      await refreshItems(selectedList.client_uuid);
      return;
    }

    const mutationUuid = generateUuid();
    await enqueueMutation({
      client_uuid: mutationUuid,
      endpoint: `/lists/${selectedList.id}/items/${item.id}`,
      method: 'PATCH',
      body: patch,
      created_at: updatedItem.updated_at,
      attempts: 0,
      status: 'pending',
      entity_client_uuid: item.client_uuid
    });
    await refreshItems(selectedList.client_uuid);

    try {
      const claimedMutation = await markMutationInFlight(mutationUuid);
      if (claimedMutation) {
        await sendMutation(claimedMutation);
      }
      await refreshItems(selectedList.client_uuid);
    } catch {
      // Keep local optimistic state and the pending mutation.
    }
  };

  const handleToggleChecked = (item: ListItemView) => handleUpdateItem(item, { is_checked: !item.is_checked });

  const handleOpenItemDetail = async (item: ListItemView) => {
    if (!item.user_product_client_uuid) {
      return;
    }

    setErrorMessage(null);
    let userProduct = await getUserProduct(item.user_product_client_uuid);

    if (!userProduct && user) {
      // The local user_products cache can miss a row that a list item still
      // references — e.g. a hard sync clears the store before that item's
      // own merge writes it back. Fall back to the server rather than
      // silently doing nothing, which just looks like the tile isn't
      // clickable.
      try {
        const response = await apiRequest<{ user_products?: UserProductRecord[] }>(
          `/user-products?owner_type=user&owner_id=${user.id}`,
          { authenticated: true }
        );
        const found = (response.user_products ?? []).find(
          (candidate) => candidate.client_uuid === item.user_product_client_uuid
        );
        if (found) {
          await putUserProduct(found);
          userProduct = found;
        }
      } catch {
        // Offline — nothing more we can do locally.
      }
    }

    if (!userProduct) {
      setErrorMessage('Този артикул не може да се отвори в момента.');
      return;
    }

    setItemDetailKey(item.client_uuid);
    setDetailUserProduct(userProduct);
  };

  const handleCloseItemDetail = () => {
    setItemDetailKey(null);
    setDetailUserProduct(null);
  };

  // A new term added inline at list-write time has no `user_products` create
  // mutation of its own — it rides along as the nested `user_product` field
  // on the list item's CREATE mutation (see ListService::createItem()). If
  // we're renaming before that create has synced, the rename must land in
  // that nested field rather than racing a PATCH against an id that doesn't
  // exist yet.
  const findPendingUserProductCreateMutation = async (userProductClientUuid: string) => {
    const queued = await getQueuedMutations(['pending', 'in_flight', 'failed']);
    return (
      queued.find((mutation) => {
        const body = mutation.body as { user_product?: { client_uuid?: string } } | undefined;
        return body?.user_product?.client_uuid === userProductClientUuid;
      }) ?? null
    );
  };

  const handleRenameUserProduct = async (
    userProduct: UserProductRecord,
    newTerm: string
  ): Promise<{ ok: boolean; error?: string }> => {
    const trimmed = newTerm.trim();
    if (!trimmed || trimmed === userProduct.term) {
      return { ok: true };
    }

    const previous = userProduct;
    const updated: UserProductRecord = {
      ...userProduct,
      term: trimmed,
      normalized_term: trimmed.toLocaleLowerCase('bg-BG')
    };

    await putUserProduct(updated);
    setDetailUserProduct(updated);

    if (!userProduct.id) {
      const pending = await findPendingUserProductCreateMutation(userProduct.client_uuid);
      if (pending) {
        const body = pending.body as { user_product?: Record<string, unknown> };
        await updateMutationBody(pending.client_uuid, {
          ...body,
          user_product: { ...body.user_product, term: trimmed }
        });
      }
      return { ok: true };
    }

    const mutationUuid = generateUuid();
    await enqueueMutation({
      client_uuid: mutationUuid,
      endpoint: `/user-products/${userProduct.id}`,
      method: 'PATCH',
      body: { term: trimmed },
      created_at: new Date().toISOString(),
      attempts: 0,
      status: 'pending',
      entity_client_uuid: userProduct.client_uuid
    });

    try {
      const claimedMutation = await markMutationInFlight(mutationUuid);
      if (claimedMutation) {
        await sendMutation(claimedMutation);
      }
      return { ok: true };
    } catch (error) {
      if (error instanceof ApiError && (error.status === 409 || error.status === 403)) {
        // A real rejection, not a connectivity problem — revert the
        // optimistic rename and drop the mutation so it doesn't keep
        // retrying a request the server will never accept.
        await putUserProduct(previous);
        setDetailUserProduct(previous);
        await removeQueuedMutationsForEntity(userProduct.client_uuid);
        return {
          ok: false,
          error: error.status === 409 ? 'Вече има термин с това име.' : 'Този термин не може да се преименува.'
        };
      }
      // Offline / network failure — keep the optimistic rename and the queued mutation.
      return { ok: true };
    }
  };

  const handleSetFavorite = async (userProduct: UserProductRecord, isFavorite: boolean) => {
    if (userProduct.owner_type === 'system') {
      return;
    }

    const updated: UserProductRecord = { ...userProduct, is_favorite: isFavorite };
    await putUserProduct(updated);
    setDetailUserProduct(updated);

    const mutationUuid = generateUuid();
    await enqueueMutation({
      client_uuid: mutationUuid,
      endpoint: `/user-products/${userProduct.id ?? userProduct.client_uuid}`,
      method: 'PATCH',
      body: { is_favorite: isFavorite },
      created_at: new Date().toISOString(),
      attempts: 0,
      status: 'pending',
      entity_client_uuid: userProduct.client_uuid
    });

    try {
      const claimedMutation = await markMutationInFlight(mutationUuid);
      if (claimedMutation) {
        await sendMutation(claimedMutation);
      }
    } catch {
      // Keep local optimistic state and the pending mutation.
    }
  };

  const handleSetCategories = async (userProduct: UserProductRecord, categoryIds: string[]) => {
    if (userProduct.owner_type === 'system') {
      return;
    }

    const updated: UserProductRecord = { ...userProduct, category_ids: categoryIds };
    await putUserProduct(updated);
    setDetailUserProduct(updated);

    const mutationUuid = generateUuid();
    await enqueueMutation({
      client_uuid: mutationUuid,
      endpoint: `/user-products/${userProduct.id ?? userProduct.client_uuid}`,
      method: 'PATCH',
      body: { category_ids: categoryIds },
      created_at: new Date().toISOString(),
      attempts: 0,
      status: 'pending',
      entity_client_uuid: userProduct.client_uuid
    });

    try {
      const claimedMutation = await markMutationInFlight(mutationUuid);
      if (claimedMutation) {
        await sendMutation(claimedMutation);
      }
    } catch {
      // Keep local optimistic state and the pending mutation.
    }
  };

  const handleRemoveItem = async (item: ListItemView) => {
    if (!selectedList) {
      return;
    }

    await deleteListItem(item.client_uuid);

    if (!item.id || !selectedList.id) {
      await removeQueuedMutationsForEntity(item.client_uuid);
      await refreshItems(selectedList.client_uuid);
      return;
    }

    const mutationUuid = generateUuid();
    await enqueueMutation({
      client_uuid: mutationUuid,
      endpoint: `/lists/${selectedList.id}/items/${item.id}`,
      method: 'DELETE',
      created_at: new Date().toISOString(),
      attempts: 0,
      status: 'pending',
      entity_client_uuid: item.client_uuid
    });
    await refreshItems(selectedList.client_uuid);

    try {
      const claimedMutation = await markMutationInFlight(mutationUuid);
      if (claimedMutation) {
        await sendMutation(claimedMutation);
      }
      await refreshItems(selectedList.client_uuid);
    } catch {
      // Keep the delete queued.
    }
  };

  const handleRenameList = async (listKey: string, name: string) => {
    const list = lists.find((candidate) => candidate.client_uuid === listKey);
    if (!list) {
      return;
    }

    const updatedList = {
      ...list,
      name,
      updated_at: new Date().toISOString()
    };

    await putList(updatedList);

    if (!list.id) {
      await updateMutationBody(list.client_uuid, { name });
      await refreshLists();
      return;
    }

    const mutationUuid = generateUuid();
    await enqueueMutation({
      client_uuid: mutationUuid,
      endpoint: `/lists/${list.id}`,
      method: 'PATCH',
      body: { name },
      created_at: updatedList.updated_at,
      attempts: 0,
      status: 'pending',
      entity_client_uuid: list.client_uuid
    });
    await refreshLists();

    try {
      const claimedMutation = await markMutationInFlight(mutationUuid);
      if (claimedMutation) {
        await sendMutation(claimedMutation);
      }
      await refreshLists();
    } catch {
      // Keep local optimistic state and the pending mutation.
    }
  };

  const handleDeleteList = async (listKey: string) => {
    const list = lists.find((candidate) => candidate.client_uuid === listKey);
    if (!list) {
      return;
    }

    await deleteList(listKey);

    if (!list.id) {
      await removeQueuedMutationsForEntity(list.client_uuid);
      await refreshLists();
      return;
    }

    const mutationUuid = generateUuid();
    await enqueueMutation({
      client_uuid: mutationUuid,
      endpoint: `/lists/${list.id}`,
      method: 'DELETE',
      created_at: new Date().toISOString(),
      attempts: 0,
      status: 'pending',
      entity_client_uuid: list.client_uuid
    });
    await refreshLists();

    try {
      const claimedMutation = await markMutationInFlight(mutationUuid);
      if (claimedMutation) {
        await sendMutation(claimedMutation);
      }
      await refreshLists();
    } catch {
      // Keep the delete queued.
    }
  };

  return (
    <main className="min-h-screen px-4 py-6 md:px-8" style={{ background: 'var(--bg)' }}>
      <div className="mx-auto max-w-3xl space-y-4">
        {selectedList ? (
          <ListScreen
            list={selectedList}
            items={items}
            mutationStatusCounts={mutationStatusCounts}
            errorMessage={errorMessage}
            draft={draft}
            onDraftChange={(field, value) => setDraft((current) => ({ ...current, [field]: value }))}
            onBack={() => setSelectedListKey(null)}
            onAddItem={handleAddItem}
            onOpenAddSearch={() => setAddSearchOpen(true)}
            onOpenItemDetail={handleOpenItemDetail}
            onToggleChecked={handleToggleChecked}
            onRemoveItem={handleRemoveItem}
            onRenameList={(name) => handleRenameList(selectedList.client_uuid, name)}
          />
        ) : (
          <ListsScreen
            lists={lists}
            itemCounts={itemCounts}
            mutationStatusCounts={mutationStatusCounts}
            createName={createName}
            errorMessage={errorMessage}
            onCreateNameChange={setCreateName}
            onCreateList={handleCreateList}
            onOpenList={setSelectedListKey}
            onRenameList={handleRenameList}
            onDeleteList={handleDeleteList}
            theme={theme}
            onSetTheme={setTheme}
            onLogout={handleLogout}
          />
        )}
      </div>

      {selectedList && addSearchOpen ? (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'var(--bg)',
            zIndex: 50,
            overflowY: 'auto'
          }}
          className="px-4 py-6 md:px-8"
        >
          <div className="mx-auto max-w-3xl space-y-4">
            <div className="appbar">
              <button
                type="button"
                onClick={() => setAddSearchOpen(false)}
                className="iconbtn"
                aria-label="Затвори"
              >
                ←
              </button>
              <div className="appbar__title">{selectedList.name}</div>
            </div>
            <AddSearchScreen
              selectedList={selectedList}
              onItemAdded={() => {
                setAddSearchOpen(false);
                void refreshItems(selectedList.client_uuid);
              }}
              isActive={addSearchOpen}
            />
          </div>
        </div>
      ) : null}

      {selectedList && itemDetailItem && detailUserProduct ? (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'var(--bg)',
            zIndex: 50,
            overflowY: 'auto'
          }}
          className="px-4 py-6 md:px-8"
        >
          <div className="mx-auto max-w-3xl space-y-4">
            <div className="appbar">
              <button
                type="button"
                onClick={handleCloseItemDetail}
                className="iconbtn"
                aria-label="Затвори"
              >
                ←
              </button>
              <div className="appbar__title">Продукт</div>
            </div>
            <UserProductDetailScreen
              item={itemDetailItem}
              userProduct={detailUserProduct}
              onRename={(newTerm) => handleRenameUserProduct(detailUserProduct, newTerm)}
              onSetFavorite={(isFavorite) => handleSetFavorite(detailUserProduct, isFavorite)}
              onSetCategories={(categoryIds) => handleSetCategories(detailUserProduct, categoryIds)}
              onUpdateItem={(patch) => handleUpdateItem(itemDetailItem, patch)}
            />
          </div>
        </div>
      ) : null}
    </main>
  );
};
