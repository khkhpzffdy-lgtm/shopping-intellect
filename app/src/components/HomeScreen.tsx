import { ApiError, fetchListWithItems, fetchLists, logout } from '../api/client';
import { clearScheduledRefresh } from '../api/session';
import { flushQueuedMutations } from '../sync/flush';
import { sendMutation } from '../sync/sendMutation';
import { useAuthStore } from '../store/auth';
import { useThemeStore } from '../store/theme';
import {
  deleteList,
  deleteListItem,
  enqueueMutation,
  getListItems,
  getListItemCounts,
  getLists,
  getMutationStatusCounts,
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
  type ShoppingListRecord
} from '../storage/db';
import { AddSearchScreen } from './AddSearchScreen';
import { ListsScreen } from './ListsScreen';
import { ListScreen } from './ListScreen';
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
  const selectedListKeyRef = useRef<string | null>(null);

  selectedListKeyRef.current = selectedListKey;

  const selectedList = useMemo(
    () => lists.find((list) => list.client_uuid === selectedListKey || list.id === selectedListKey) ?? null,
    [lists, selectedListKey]
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
    void refreshLists();

    const pullListsFromServer = async () => {
      try {
        const { lists: serverLists } = await fetchLists();
        await Promise.all(serverLists.map((serverList) => mergeServerList(serverList)));
        await refreshLists();
      } catch {
        // Offline boot or network failure — keep showing the local-first data (07 §3.3).
      }
    };

    void pullListsFromServer();
  }, []);

  useEffect(() => {
    if (!selectedListKey) {
      return;
    }

    void refreshItems(selectedListKey);

    const serverListId = selectedList?.id;
    if (!serverListId) {
      // List hasn't synced yet — nothing to pull until it has a server id.
      return;
    }

    const pullListItemsFromServer = async () => {
      try {
        const { items: serverItems } = await fetchListWithItems(serverListId);
        await Promise.all(serverItems.map((serverItem) => mergeServerListItem(serverItem, selectedListKey)));
        await refreshItems(selectedListKey);
      } catch {
        // Offline boot or network failure — keep showing the local-first data (07 §3.3).
      }
    };

    void pullListItemsFromServer();
  }, [selectedListKey, selectedList?.id]);

  useEffect(() => {
    if (!user) {
      return;
    }

    let isActive = true;

    const runQueuedMutationDrain = async () => {
      try {
        await flushQueuedMutations();
      } finally {
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

    void runQueuedMutationDrain();

    const handleOnline = () => {
      void runQueuedMutationDrain();
    };

    window.addEventListener('online', handleOnline);

    return () => {
      isActive = false;
      window.removeEventListener('online', handleOnline);
    };
  }, [user]);

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

  const handleToggleChecked = async (item: ListItemView) => {
    if (!selectedList) {
      return;
    }

    const updatedItem = {
      ...item,
      is_checked: !item.is_checked,
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
      body: { is_checked: updatedItem.is_checked },
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

  const handleRenameList = async (name: string) => {
    if (!selectedList) {
      return;
    }

    const updatedList = {
      ...selectedList,
      name,
      updated_at: new Date().toISOString()
    };

    await putList(updatedList);

    if (!selectedList.id) {
      await updateMutationBody(selectedList.client_uuid, { name });
      await refreshLists();
      return;
    }

    const mutationUuid = generateUuid();
    await enqueueMutation({
      client_uuid: mutationUuid,
      endpoint: `/lists/${selectedList.id}`,
      method: 'PATCH',
      body: { name },
      created_at: updatedList.updated_at,
      attempts: 0,
      status: 'pending',
      entity_client_uuid: selectedList.client_uuid
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
            onToggleChecked={handleToggleChecked}
            onRemoveItem={handleRemoveItem}
            onRenameList={handleRenameList}
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
              onItemAdded={() => setAddSearchOpen(false)}
              isActive={addSearchOpen}
            />
          </div>
        </div>
      ) : null}
    </main>
  );
};
