import { useEffect, useState } from 'react';
import { ApiError, apiRequest, fetchLists, type ServerListDto } from '../api/client';
import { useAuthStore } from '../store/auth';
import {
  enqueueMutation,
  markMutationInFlight,
  putListItem,
  touchListUpdatedAt,
  type StoreProductRecord,
  type UserProductRecord
} from '../storage/db';
import { sendMutation } from '../sync/sendMutation';
import { generateUuid } from '../utils/uuid';
import { StoreProductDetailScreen } from './StoreProductDetailScreen';
import { UserProductDetailScreen } from './UserProductDetailScreen';

type CategoryDto = {
  id: string;
  slug: string;
  name: string;
  parent_id?: string | null;
};

type CategoryDetailScreenProps = {
  categoryId: string;
  onClose: () => void;
};

const formatActionError = (error: unknown, fallback: string) => {
  if (error instanceof ApiError) {
    return error.code ? `${fallback} (${error.code})` : `${fallback} (${error.message})`;
  }
  return fallback;
};

export const CategoryDetailScreen = ({ categoryId, onClose }: CategoryDetailScreenProps) => {
  const user = useAuthStore((state) => state.user);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [category, setCategory] = useState<CategoryDto | null>(null);
  const [children, setChildren] = useState<CategoryDto[]>([]);
  const [userProducts, setUserProducts] = useState<UserProductRecord[]>([]);
  const [storeProducts, setStoreProducts] = useState<StoreProductRecord[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [openChildId, setOpenChildId] = useState<string | null>(null);
  const [detailUserProduct, setDetailUserProduct] = useState<UserProductRecord | null>(null);
  const [detailStoreProduct, setDetailStoreProduct] = useState<StoreProductRecord | null>(null);

  const [showCreateTerm, setShowCreateTerm] = useState(false);
  const [createTermDraft, setCreateTermDraft] = useState('');
  const [showCreateItem, setShowCreateItem] = useState(false);
  const [createItemName, setCreateItemName] = useState('');
  const [createItemImageUrl, setCreateItemImageUrl] = useState('');
  const [creating, setCreating] = useState(false);

  const [listPickerFor, setListPickerFor] = useState<
    { type: 'user_product'; record: UserProductRecord } | { type: 'store_product'; record: StoreProductRecord } | null
  >(null);
  const [lists, setLists] = useState<ServerListDto[] | null>(null);
  const [addingToList, setAddingToList] = useState(false);

  const load = async () => {
    setStatus('loading');
    setErrorMessage(null);
    try {
      const response = await apiRequest<{
        category: CategoryDto;
        children: CategoryDto[];
        user_products: UserProductRecord[];
        store_products: StoreProductRecord[];
      }>(`/categories/${categoryId}/products`, { authenticated: true });
      setCategory(response.category);
      setChildren(response.children ?? []);
      setUserProducts(response.user_products ?? []);
      setStoreProducts(response.store_products ?? []);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryId]);

  const handleCreateTerm = async () => {
    if (!createTermDraft.trim() || creating) return;
    setCreating(true);
    setErrorMessage(null);
    try {
      const response = await apiRequest<{ user_product: UserProductRecord }>('/user-products', {
        method: 'POST',
        authenticated: true,
        body: { term: createTermDraft.trim(), client_uuid: generateUuid(), category_id: categoryId }
      });
      setUserProducts((prev) => [...prev, response.user_product]);
      setCreateTermDraft('');
      setShowCreateTerm(false);
    } catch (error) {
      setErrorMessage(formatActionError(error, 'Терминът не може да се добави.'));
    } finally {
      setCreating(false);
    }
  };

  const handleCreateItem = async () => {
    if (!createItemName.trim() || creating) return;
    setCreating(true);
    setErrorMessage(null);
    try {
      const response = await apiRequest<{ store_product: StoreProductRecord }>('/store-products', {
        method: 'POST',
        authenticated: true,
        body: {
          name: createItemName.trim(),
          image_url: createItemImageUrl.trim() || null,
          client_uuid: generateUuid(),
          category_id: categoryId
        }
      });
      setStoreProducts((prev) => [...prev, response.store_product]);
      setCreateItemName('');
      setCreateItemImageUrl('');
      setShowCreateItem(false);
    } catch (error) {
      setErrorMessage(formatActionError(error, 'Артикулът не може да се добави.'));
    } finally {
      setCreating(false);
    }
  };

  const handleArchiveUserProduct = async (userProduct: UserProductRecord) => {
    setErrorMessage(null);
    try {
      await apiRequest(`/user-products/${userProduct.id}`, {
        method: 'PATCH',
        authenticated: true,
        body: { is_archived: true }
      });
      setUserProducts((prev) => prev.filter((candidate) => candidate.client_uuid !== userProduct.client_uuid));
    } catch (error) {
      setErrorMessage(
        error instanceof ApiError && error.code === 'in_use'
          ? 'Премахни го от списъка/списъците си, за да го архивираш.'
          : formatActionError(error, 'Не може да се архивира.')
      );
    }
  };

  const handleArchiveStoreProduct = async (storeProduct: StoreProductRecord) => {
    setErrorMessage(null);
    try {
      await apiRequest(`/store-products/${storeProduct.id}`, {
        method: 'PATCH',
        authenticated: true,
        body: { is_archived: true }
      });
      setStoreProducts((prev) => prev.filter((candidate) => candidate.client_uuid !== storeProduct.client_uuid));
    } catch (error) {
      setErrorMessage(
        error instanceof ApiError && error.code === 'in_use'
          ? 'Премахни го от списъка/списъците си, за да го архивираш.'
          : formatActionError(error, 'Не може да се архивира.')
      );
    }
  };

  const openListPicker = async (target: typeof listPickerFor) => {
    setListPickerFor(target);
    if (!lists) {
      try {
        const response = await fetchLists();
        setLists(response.lists);
      } catch {
        setLists([]);
      }
    }
  };

  const handleAddToList = async (list: ServerListDto) => {
    if (!listPickerFor || !user || addingToList) return;
    setAddingToList(true);
    setErrorMessage(null);
    try {
      const now = new Date().toISOString();
      const itemClientUuid = generateUuid();
      const isUserProduct = listPickerFor.type === 'user_product';

      await putListItem({
        client_uuid: itemClientUuid,
        list_client_uuid: list.client_uuid,
        list_id: list.id,
        ...(isUserProduct
          ? { user_product_client_uuid: listPickerFor.record.client_uuid, user_product_id: listPickerFor.record.id }
          : { store_product_client_uuid: listPickerFor.record.client_uuid, store_product_id: listPickerFor.record.id }),
        quantity: 1,
        unit: 'piece',
        is_checked: false,
        created_at: now,
        updated_at: now
      });
      await touchListUpdatedAt(list.client_uuid, now);

      await enqueueMutation({
        client_uuid: itemClientUuid,
        endpoint: `/lists/${list.id}/items`,
        method: 'POST',
        body: {
          client_uuid: itemClientUuid,
          quantity: 1,
          unit: 'piece',
          is_checked: false,
          ...(isUserProduct
            ? { user_product_id: listPickerFor.record.id }
            : { store_product_id: listPickerFor.record.id })
        },
        created_at: now,
        attempts: 0,
        status: 'pending',
        entity_client_uuid: itemClientUuid
      });

      try {
        const claimedMutation = await markMutationInFlight(itemClientUuid);
        if (claimedMutation) {
          await sendMutation(claimedMutation);
        }
      } catch {
        // queued — will sync on next drain
      }

      setListPickerFor(null);
    } finally {
      setAddingToList(false);
    }
  };

  if (openChildId) {
    return <CategoryDetailScreen categoryId={openChildId} onClose={() => setOpenChildId(null)} />;
  }

  return (
    <div
      data-testid="category-detail"
      style={{ position: 'fixed', inset: 0, background: 'var(--bg)', zIndex: 110, overflowY: 'auto' }}
      className="px-4 py-6 md:px-8"
    >
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="appbar">
          <button type="button" onClick={onClose} className="iconbtn" aria-label="Затвори">
            ←
          </button>
          <div className="appbar__title">{category?.name ?? ''}</div>
        </div>

        {errorMessage ? (
          <p role="alert" style={{ color: 'var(--danger)', fontSize: 'var(--fs-sm)' }}>
            {errorMessage}
          </p>
        ) : null}

        {status === 'loading' ? (
          <p style={{ color: 'var(--ink-2)', fontSize: 'var(--fs-body)' }}>Зарежда се...</p>
        ) : status === 'error' ? (
          <p style={{ color: 'var(--ink-2)', fontSize: 'var(--fs-body)' }}>Бъкетът не може да се зареди в момента.</p>
        ) : (
          <>
            {children.length > 0 ? (
              <div className="glist">
                {children.map((child) => (
                  <article key={child.id} className="git">
                    <button
                      type="button"
                      className="git__main"
                      style={{ background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer', padding: 0 }}
                      onClick={() => setOpenChildId(child.id)}
                      data-testid={`category-child-${child.id}`}
                    >
                      <div className="git__name">{child.name}</div>
                    </button>
                  </article>
                ))}
              </div>
            ) : null}

            <div className="glist">
              {userProducts.length === 0 && storeProducts.length === 0 ? (
                <section
                  className="p-6"
                  style={{ background: 'var(--card)', borderRadius: 'var(--radius)', border: '1px solid var(--card-border)' }}
                >
                  <p style={{ color: 'var(--ink-2)', fontSize: 'var(--fs-body)' }}>
                    Все още няма нищо тук от теб.
                  </p>
                </section>
              ) : null}

              {userProducts.map((userProduct) => (
                <article key={userProduct.client_uuid} className="git" data-testid={`user-product-row-${userProduct.client_uuid}`}>
                  <button
                    type="button"
                    className="git__main"
                    style={{ background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer', padding: 0 }}
                    onClick={() => setDetailUserProduct(userProduct)}
                  >
                    <div className="git__name">{userProduct.term}</div>
                    {userProduct.owner_type === 'system' ? (
                      <div className="git__sub">общ термин</div>
                    ) : null}
                  </button>
                  <button type="button" className="catchip" onClick={() => void openListPicker({ type: 'user_product', record: userProduct })}>
                    + Списък
                  </button>
                  {userProduct.owner_type !== 'system' ? (
                    <button type="button" className="git__remove" onClick={() => void handleArchiveUserProduct(userProduct)}>
                      Архивирай
                    </button>
                  ) : null}
                </article>
              ))}

              {storeProducts.map((storeProduct) => (
                <article key={storeProduct.client_uuid} className="git" data-testid={`store-product-row-${storeProduct.client_uuid}`}>
                  <button
                    type="button"
                    className="git__main"
                    style={{ background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer', padding: 0 }}
                    onClick={() => setDetailStoreProduct(storeProduct)}
                  >
                    <div className="git__name">{storeProduct.name}</div>
                  </button>
                  <button type="button" className="catchip" onClick={() => void openListPicker({ type: 'store_product', record: storeProduct })}>
                    + Списък
                  </button>
                  <button type="button" className="git__remove" onClick={() => void handleArchiveStoreProduct(storeProduct)}>
                    Архивирай
                  </button>
                </article>
              ))}
            </div>

            {listPickerFor ? (
              <div className="group" data-testid="list-picker">
                <div className="group__head">
                  <span className="group__title">Добави в списък</span>
                  <button type="button" className="iconbtn" aria-label="Затвори" onClick={() => setListPickerFor(null)}>
                    ✕
                  </button>
                </div>
                {lists === null ? (
                  <p style={{ color: 'var(--ink-2)', fontSize: 'var(--fs-sm)' }}>Зарежда се...</p>
                ) : lists.length === 0 ? (
                  <p style={{ color: 'var(--ink-2)', fontSize: 'var(--fs-sm)' }}>Все още няма списъци.</p>
                ) : (
                  <div className="glist">
                    {lists.map((list) => (
                      <button
                        key={list.id}
                        type="button"
                        className="addsearch__result"
                        onClick={() => void handleAddToList(list)}
                        disabled={addingToList}
                      >
                        <span className="addsearch__result-term">{list.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : null}

            <div className="group">
              <div className="group__head">
                <span className="group__title">Добави</span>
              </div>
              {showCreateTerm ? (
                <form
                  className="addsearch__manualform"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void handleCreateTerm();
                  }}
                >
                  <input
                    aria-label="Нов термин"
                    value={createTermDraft}
                    onChange={(event) => setCreateTermDraft(event.target.value)}
                    placeholder="Напр. мляко"
                    className="addbar__field"
                  />
                  <div className="addsearch__manualform-actions">
                    <button type="submit" className="addsearch__manualform-submit" disabled={creating || !createTermDraft.trim()}>
                      Добави
                    </button>
                    <button type="button" className="addsearch__manualform-cancel" onClick={() => setShowCreateTerm(false)}>
                      Отказ
                    </button>
                  </div>
                </form>
              ) : (
                <button type="button" className="addsearch__addnew" onClick={() => setShowCreateTerm(true)}>
                  <span aria-hidden="true">＋</span> Нов термин в този бъкет
                </button>
              )}

              {showCreateItem ? (
                <form
                  className="addsearch__manualform"
                  data-testid="manual-store-product-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void handleCreateItem();
                  }}
                >
                  <input
                    aria-label="Име на артикула"
                    value={createItemName}
                    onChange={(event) => setCreateItemName(event.target.value)}
                    placeholder="Напр. Мляко Данон 2% 1л"
                    className="addbar__field"
                  />
                  <input
                    aria-label="Снимка (URL)"
                    value={createItemImageUrl}
                    onChange={(event) => setCreateItemImageUrl(event.target.value)}
                    placeholder="Снимка (по избор)"
                    className="addbar__field"
                  />
                  <div className="addsearch__manualform-actions">
                    <button type="submit" className="addsearch__manualform-submit" disabled={creating || !createItemName.trim()}>
                      Добави
                    </button>
                    <button type="button" className="addsearch__manualform-cancel" onClick={() => setShowCreateItem(false)}>
                      Отказ
                    </button>
                  </div>
                </form>
              ) : (
                <button type="button" className="addsearch__addnew" onClick={() => setShowCreateItem(true)}>
                  <span aria-hidden="true">＋</span> Конкретен артикул в този бъкет
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {detailUserProduct ? (
        <div style={{ position: 'fixed', inset: 0, background: 'var(--bg)', zIndex: 120, overflowY: 'auto' }} className="px-4 py-6 md:px-8">
          <div className="mx-auto max-w-3xl space-y-4">
            <div className="appbar">
              <button type="button" onClick={() => setDetailUserProduct(null)} className="iconbtn" aria-label="Затвори">
                ←
              </button>
              <div className="appbar__title">Термин</div>
            </div>
            <UserProductDetailScreen
              userProduct={detailUserProduct}
              onRename={async (newTerm) => {
                try {
                  const response = await apiRequest<{ user_product: UserProductRecord }>(`/user-products/${detailUserProduct.id}`, {
                    method: 'PATCH',
                    authenticated: true,
                    body: { term: newTerm }
                  });
                  setDetailUserProduct(response.user_product);
                  setUserProducts((prev) =>
                    prev.map((candidate) => (candidate.client_uuid === response.user_product.client_uuid ? response.user_product : candidate))
                  );
                  return { ok: true };
                } catch (error) {
                  return {
                    ok: false,
                    error:
                      error instanceof ApiError && error.code === 'duplicate_term'
                        ? 'Вече има термин с това име.'
                        : 'Преименуването е неуспешно.'
                  };
                }
              }}
              onSetFavorite={async (isFavorite) => {
                const response = await apiRequest<{ user_product: UserProductRecord }>(`/user-products/${detailUserProduct.id}`, {
                  method: 'PATCH',
                  authenticated: true,
                  body: { is_favorite: isFavorite }
                });
                setDetailUserProduct(response.user_product);
                setUserProducts((prev) =>
                  prev.map((candidate) => (candidate.client_uuid === response.user_product.client_uuid ? response.user_product : candidate))
                );
              }}
              onSetCategories={async (categoryIds) => {
                const response = await apiRequest<{ user_product: UserProductRecord }>(`/user-products/${detailUserProduct.id}`, {
                  method: 'PATCH',
                  authenticated: true,
                  body: { category_ids: categoryIds }
                });
                setDetailUserProduct(response.user_product);
                setUserProducts((prev) =>
                  prev.map((candidate) => (candidate.client_uuid === response.user_product.client_uuid ? response.user_product : candidate))
                );
              }}
            />
          </div>
        </div>
      ) : null}

      {detailStoreProduct ? (
        <div style={{ position: 'fixed', inset: 0, background: 'var(--bg)', zIndex: 120, overflowY: 'auto' }} className="px-4 py-6 md:px-8">
          <div className="mx-auto max-w-3xl space-y-4">
            <div className="appbar">
              <button type="button" onClick={() => setDetailStoreProduct(null)} className="iconbtn" aria-label="Затвори">
                ←
              </button>
              <div className="appbar__title">Артикул</div>
            </div>
            <StoreProductDetailScreen
              storeProduct={detailStoreProduct}
              canEdit={detailStoreProduct.created_by_user_id === undefined || detailStoreProduct.created_by_user_id === user?.id}
              onRename={async (newName) => {
                try {
                  const response = await apiRequest<{ store_product: StoreProductRecord }>(`/store-products/${detailStoreProduct.id}`, {
                    method: 'PATCH',
                    authenticated: true,
                    body: { name: newName }
                  });
                  setDetailStoreProduct(response.store_product);
                  setStoreProducts((prev) =>
                    prev.map((candidate) => (candidate.client_uuid === response.store_product.client_uuid ? response.store_product : candidate))
                  );
                  return { ok: true };
                } catch {
                  return { ok: false, error: 'Преименуването е неуспешно.' };
                }
              }}
              onSetImageUrl={async (imageUrl) => {
                const response = await apiRequest<{ store_product: StoreProductRecord }>(`/store-products/${detailStoreProduct.id}`, {
                  method: 'PATCH',
                  authenticated: true,
                  body: { image_url: imageUrl ?? '' }
                });
                setDetailStoreProduct(response.store_product);
                setStoreProducts((prev) =>
                  prev.map((candidate) => (candidate.client_uuid === response.store_product.client_uuid ? response.store_product : candidate))
                );
              }}
              onSetBarcode={async (barcodeValue) => {
                const response = await apiRequest<{ store_product: StoreProductRecord }>(`/store-products/${detailStoreProduct.id}`, {
                  method: 'PATCH',
                  authenticated: true,
                  body: { barcode_value: barcodeValue }
                });
                setDetailStoreProduct(response.store_product);
                setStoreProducts((prev) =>
                  prev.map((candidate) => (candidate.client_uuid === response.store_product.client_uuid ? response.store_product : candidate))
                );
              }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
};
