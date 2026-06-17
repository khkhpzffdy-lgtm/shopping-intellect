import { ApiError, logout } from '../api/client';
import { clearScheduledRefresh } from '../api/session';
import { applyMutationSuccess } from '../sync/applyMutationSuccess';
import { flushQueuedMutations } from '../sync/flush';
import { useAuthStore } from '../store/auth';
import { useThemeStore } from '../store/theme';
import {
  deleteListItem,
  enqueueMutation,
  getListItems,
  getListItemCounts,
  getLists,
  getPendingMutationCounts,
  getUserProductByTerm,
  markMutationDone,
  putList,
  putListItem,
  putUserProduct,
  removeQueuedMutationsForEntity,
  touchListUpdatedAt,
  updateMutationBody,
  type ListItemView,
  type ShoppingListRecord
} from '../storage/db';
import { ListsScreen } from './ListsScreen';
import { ListScreen } from './ListScreen';
import { apiRequest } from '../api/client';
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

type HomeScreenProps = {
  onOpenAddSearch: (list: ShoppingListRecord) => void;
  onItemAdded: () => void;
};

export const HomeScreen = ({ onOpenAddSearch, onItemAdded }: HomeScreenProps) => {
  const user = useAuthStore((state) => state.user);
  const theme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);
  const [lists, setLists] = useState<ShoppingListRecord[]>([]);
  const [selectedListKey, setSelectedListKey] = useState<string | null>(null);
  const [items, setItems] = useState<ListItemView[]>([]);
  const [pendingCounts, setPendingCounts] = useState<Record<string, number>>({});
  const [itemCounts, setItemCounts] = useState<Record<string, number>>({});
  const [createName, setCreateName] = useState('');
  const [draft, setDraft] = useState({ term: '', quantity: '', unit: '' });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const selectedListKeyRef = useRef<string | null>(null);

  selectedListKeyRef.current = selectedListKey;

  const selectedList = useMemo(
    () => lists.find((list) => list.client_uuid === selectedListKey || list.id === selectedListKey) ?? null,
    [lists, selectedListKey]
  );

  const refreshPendingCounts = async () => {
    setPendingCounts(await getPendingMutationCounts());
  };

  const refreshLists = async () => {
    setLists(await getLists());
    setItemCounts(await getListItemCounts());
    await refreshPendingCounts();
  };

  const refreshItems = async (listKey: string) => {
    setItems(await getListItems(listKey));
    setItemCounts(await getListItemCounts());
    await refreshPendingCounts();
  };

  useEffect(() => {
    void refreshLists();
  }, []);

  useEffect(() => {
    if (!selectedListKey) {
      return;
    }

    void refreshItems(selectedListKey);
  }, [selectedListKey]);

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

      const response = await apiRequest<{ list?: { id?: string } }>('/lists', {
        method: 'POST',
        body: {
          name: optimisticList.name,
          owner_type: 'user',
          owner_id: user.id,
          client_uuid: clientUuid
        },
        authenticated: true
      });

      await applyMutationSuccess(
        {
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
        },
        response
      );
      await markMutationDone(clientUuid);
      await refreshLists();
    } catch (error) {
      setErrorMessage(
        formatActionError(error, 'Could not create the list on this device yet. Please try again.')
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

      if (!selectedList.id) {
        return;
      }

      const response = await apiRequest<{
        item?: { id?: string; is_checked?: boolean };
        user_product?: { id?: string };
      }>(`/lists/${selectedList.id}/items`, {
        method: 'POST',
        body: {
          client_uuid: itemClientUuid,
          quantity: optimisticItem.quantity,
          unit: optimisticItem.unit,
          user_product: {
            client_uuid: product.client_uuid,
            term: product.term
          }
        },
        authenticated: true
      });

      await applyMutationSuccess(
        {
          client_uuid: itemClientUuid,
          endpoint: `/lists/${selectedList.id}/items`,
          method: 'POST',
          body: {
            client_uuid: itemClientUuid,
            quantity: optimisticItem.quantity,
            unit: optimisticItem.unit,
            user_product: {
              client_uuid: product.client_uuid,
              term: product.term
            }
          },
          created_at: now,
          attempts: 0,
          status: 'pending',
          entity_client_uuid: itemClientUuid
        },
        response
      );
      await markMutationDone(itemClientUuid);
      await refreshItems(selectedList.client_uuid);
    } catch (error) {
      setErrorMessage(
        formatActionError(error, 'Could not add the item on this device yet. Please try again.')
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
      await apiRequest(`/lists/${selectedList.id}/items/${item.id}`, {
        method: 'PATCH',
        body: { is_checked: updatedItem.is_checked },
        authenticated: true
      });
      await markMutationDone(mutationUuid);
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
      await apiRequest(`/lists/${selectedList.id}/items/${item.id}`, {
        method: 'DELETE',
        authenticated: true
      });
      await markMutationDone(mutationUuid);
      await refreshItems(selectedList.client_uuid);
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
            pendingCounts={pendingCounts}
            errorMessage={errorMessage}
            draft={draft}
            onDraftChange={(field, value) => setDraft((current) => ({ ...current, [field]: value }))}
            onBack={() => setSelectedListKey(null)}
            onAddItem={handleAddItem}
            onOpenAddSearch={() => onOpenAddSearch(selectedList)}
            onToggleChecked={handleToggleChecked}
            onRemoveItem={handleRemoveItem}
          />
        ) : (
          <ListsScreen
            lists={lists}
            itemCounts={itemCounts}
            pendingCounts={pendingCounts}
            createName={createName}
            errorMessage={errorMessage}
            onCreateNameChange={setCreateName}
            onCreateList={handleCreateList}
            onOpenList={setSelectedListKey}
            theme={theme}
            onSetTheme={setTheme}
            onLogout={handleLogout}
          />
        )}
      </div>
    </main>
  );
};
