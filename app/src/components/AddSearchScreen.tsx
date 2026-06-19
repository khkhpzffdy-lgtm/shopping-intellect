import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../api/client';
import { useAuthStore } from '../store/auth';
import {
  enqueueMutation,
  getAllUserProducts,
  getUserProductByTerm,
  markMutationInFlight,
  putListItem,
  putStoreProduct,
  putUserProduct,
  touchListUpdatedAt,
  type ShoppingListRecord,
  type StoreProductRecord,
  type UserProductRecord
} from '../storage/db';
import { sendMutation } from '../sync/sendMutation';
import { generateUuid } from '../utils/uuid';

type AddSearchScreenProps = {
  selectedList: ShoppingListRecord | null;
  onItemAdded: () => void;
  isActive?: boolean;
};

const QuickAddSection = ({ title, emptyLabel }: { title: string; emptyLabel: string }) => (
  <section className="quickadd">
    <h2 className="quickadd__title">{title}</h2>
    <p className="quickadd__empty">{emptyLabel}</p>
  </section>
);

export const AddSearchScreen = ({ selectedList, onItemAdded, isActive = true }: AddSearchScreenProps) => {
  const user = useAuthStore((state) => state.user);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UserProductRecord[]>([]);
  const [allTerms, setAllTerms] = useState<UserProductRecord[]>([]);
  const [adding, setAdding] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showManualForm, setShowManualForm] = useState(false);
  const [manualName, setManualName] = useState('');
  const [manualPhotoUrl, setManualPhotoUrl] = useState('');
  const [manualBarcode, setManualBarcode] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!user || !isActive) return;

    const loadTerms = async () => {
      try {
        const response = await apiRequest<{ user_products?: UserProductRecord[] }>(
          `/user-products?owner_type=user&owner_id=${user.id}`,
          { authenticated: true }
        );
        for (const t of response.user_products ?? []) {
          await putUserProduct(t);
        }
      } catch {
        // offline — local IndexedDB copy is the source
      }

      const local = await getAllUserProducts();
      setAllTerms(local.filter((t) => t.owner_id === user.id));
    };

    void loadTerms();
  }, [user, isActive]);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    const normalizedQuery = query.trim().toLocaleLowerCase('bg-BG');
    setResults(
      allTerms
        .filter(
          (t) =>
            t.normalized_term.includes(normalizedQuery) ||
            t.term.toLocaleLowerCase('bg-BG').includes(normalizedQuery)
        )
        .slice(0, 10)
    );
  }, [query, allTerms]);

  const addItemToList = async (product: UserProductRecord) => {
    if (!user || !selectedList) return;
    setAdding(true);
    setErrorMessage(null);
    try {
      const now = new Date().toISOString();
      const itemClientUuid = generateUuid();
      const optimisticItem = {
        client_uuid: itemClientUuid,
        list_client_uuid: selectedList.client_uuid,
        list_id: selectedList.id,
        user_product_client_uuid: product.client_uuid,
        user_product_id: product.id,
        quantity: 1,
        unit: 'piece',
        is_checked: false,
        created_at: now,
        updated_at: now
      };

      await putListItem(optimisticItem);
      await touchListUpdatedAt(selectedList.client_uuid, now);

      const mutationBody = {
        client_uuid: itemClientUuid,
        quantity: 1,
        unit: 'piece',
        is_checked: false,
        user_product: {
          client_uuid: product.client_uuid,
          term: product.term
        }
      };

      await enqueueMutation({
        client_uuid: itemClientUuid,
        endpoint: selectedList.id
          ? `/lists/${selectedList.id}/items`
          : `/lists/${selectedList.client_uuid}/items`,
        method: 'POST',
        body: mutationBody,
        created_at: now,
        attempts: 0,
        status: 'pending',
        entity_client_uuid: itemClientUuid
      });

      setQuery('');
      onItemAdded();

      try {
        const claimedMutation = await markMutationInFlight(itemClientUuid);
        if (claimedMutation) {
          await sendMutation(claimedMutation);
        }
      } catch {
        // queued — will sync on next drain
      }
    } finally {
      setAdding(false);
    }
  };

  const addNewTerm = async () => {
    if (!user || !query.trim()) return;
    const term = query.trim();
    const now = new Date().toISOString();
    const existing = await getUserProductByTerm(term, user.id);
    const product: UserProductRecord = existing ?? {
      client_uuid: generateUuid(),
      owner_type: 'user',
      owner_id: user.id,
      term,
      normalized_term: term.toLocaleLowerCase('bg-BG'),
      created_at: now
    };
    await putUserProduct(product);
    setAllTerms((prev) => {
      const already = prev.some((t) => t.client_uuid === product.client_uuid);
      return already ? prev : [...prev, product];
    });
    await addItemToList(product);
  };

  const addItemViaStoreProduct = async (storeProduct: StoreProductRecord) => {
    if (!user || !selectedList) return;
    setAdding(true);
    setErrorMessage(null);
    try {
      const now = new Date().toISOString();
      const itemClientUuid = generateUuid();
      const optimisticItem = {
        client_uuid: itemClientUuid,
        list_client_uuid: selectedList.client_uuid,
        list_id: selectedList.id,
        store_product_client_uuid: storeProduct.client_uuid,
        store_product_id: storeProduct.id,
        quantity: 1,
        unit: 'piece',
        is_checked: false,
        created_at: now,
        updated_at: now
      };

      await putListItem(optimisticItem);
      await touchListUpdatedAt(selectedList.client_uuid, now);

      const mutationBody = {
        client_uuid: itemClientUuid,
        quantity: 1,
        unit: 'piece',
        is_checked: false,
        store_product: {
          client_uuid: storeProduct.client_uuid,
          name: storeProduct.name,
          image_url: storeProduct.image_url ?? null
        }
      };

      await enqueueMutation({
        client_uuid: itemClientUuid,
        endpoint: selectedList.id
          ? `/lists/${selectedList.id}/items`
          : `/lists/${selectedList.client_uuid}/items`,
        method: 'POST',
        body: mutationBody,
        created_at: now,
        attempts: 0,
        status: 'pending',
        entity_client_uuid: itemClientUuid
      });

      onItemAdded();

      try {
        const claimedMutation = await markMutationInFlight(itemClientUuid);
        if (claimedMutation) {
          await sendMutation(claimedMutation);
        }
      } catch {
        // queued — will sync on next drain
      }
    } finally {
      setAdding(false);
    }
  };

  const addManualStoreProduct = async () => {
    if (!user) return;
    const name = manualName.trim();
    if (!name) return;

    const now = new Date().toISOString();
    const storeProduct: StoreProductRecord = {
      client_uuid: generateUuid(),
      source: 'user',
      created_by_user_id: user.id,
      name,
      image_url: manualPhotoUrl.trim() || null,
      created_at: now
    };

    await putStoreProduct(storeProduct);
    setShowManualForm(false);
    setManualName('');
    setManualPhotoUrl('');
    setManualBarcode('');
    await addItemViaStoreProduct(storeProduct);
  };

  const noMatch = query.trim() !== '' && results.length === 0;

  if (!selectedList) {
    return (
      <div className="addsearch">
        <div className="addsearch__nolist">
          <p className="addsearch__nolist-text">Отвори списък, за да добавиш</p>
        </div>
      </div>
    );
  }

  return (
    <div className="addsearch">
      <div className="addbar">
        <span style={{ display: 'flex', alignItems: 'center', paddingLeft: 8, color: 'var(--ink-2)', flexShrink: 0 }} aria-hidden="true">🔍</span>
        <input
          ref={inputRef}
          aria-label="Търси термин"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Напр. мляко, хляб..."
          className="addbar__field"
        />
        {query ? (
          <button
            type="button"
            className="iconbtn"
            onClick={() => setQuery('')}
            aria-label="Изчисти"
            style={{ width: 32, height: 32, fontSize: 16 }}
          >
            ✕
          </button>
        ) : null}
      </div>

      {errorMessage ? (
        <p role="alert" style={{ color: 'var(--danger)', fontSize: 'var(--fs-sm)', padding: '8px 0' }}>
          {errorMessage}
        </p>
      ) : null}

      {query.trim() ? (
        <div className="glist" style={{ marginTop: 8 }}>
          {results.map((term) => (
            <button
              key={term.client_uuid}
              type="button"
              className="addsearch__result"
              onClick={() => void addItemToList(term)}
              disabled={adding}
            >
              <span className="addsearch__result-icon" aria-hidden="true">🛒</span>
              <span className="addsearch__result-term">{term.term}</span>
            </button>
          ))}

          {noMatch ? (
            <button
              type="button"
              className="addsearch__addnew"
              onClick={() => void addNewTerm()}
              disabled={adding}
              data-testid="add-new-term"
            >
              <span aria-hidden="true">＋</span>
              {' '}Добави „{query.trim()}" като нов термин
            </button>
          ) : null}

          {noMatch && !showManualForm ? (
            <button
              type="button"
              className="addsearch__addnew"
              onClick={() => {
                setManualName(query.trim());
                setShowManualForm(true);
              }}
              disabled={adding}
              data-testid="add-specific-item"
            >
              <span aria-hidden="true">＋</span>
              {' '}Добави конкретен артикул
            </button>
          ) : null}

          {showManualForm ? (
            <form
              className="addsearch__manualform"
              data-testid="manual-store-product-form"
              onSubmit={(e) => {
                e.preventDefault();
                void addManualStoreProduct();
              }}
            >
              <input
                aria-label="Име на артикула"
                value={manualName}
                onChange={(e) => setManualName(e.target.value)}
                placeholder="Напр. Мляко Данон 2% 1л"
                className="addbar__field"
              />
              <input
                aria-label="Снимка (URL)"
                value={manualPhotoUrl}
                onChange={(e) => setManualPhotoUrl(e.target.value)}
                placeholder="Снимка (по избор)"
                className="addbar__field"
              />
              <input
                aria-label="Баркод"
                value={manualBarcode}
                onChange={(e) => setManualBarcode(e.target.value)}
                placeholder="Баркод (по избор)"
                className="addbar__field"
              />
              <div className="addsearch__manualform-actions">
                <button
                  type="submit"
                  className="addsearch__manualform-submit"
                  disabled={adding || !manualName.trim()}
                  data-testid="manual-store-product-submit"
                >
                  Добави
                </button>
                <button
                  type="button"
                  className="addsearch__manualform-cancel"
                  onClick={() => setShowManualForm(false)}
                  disabled={adding}
                >
                  Отказ
                </button>
              </div>
            </form>
          ) : null}
        </div>
      ) : (
        <>
          <QuickAddSection title="Любими" emptyLabel="Все още няма любими" />
          <QuickAddSection title="Скорошни" emptyLabel="Все още няма скорошни" />
          <QuickAddSection title="Чести" emptyLabel="Все още няма чести" />
        </>
      )}
    </div>
  );
};
