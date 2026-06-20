import { useEffect, useState } from 'react';
import { apiRequest } from '../api/client';
import type { ListItemView, UserProductRecord } from '../storage/db';

type CategoryDto = {
  id: string;
  name: string;
};

type UserProductDetailScreenProps = {
  item: ListItemView;
  userProduct: UserProductRecord;
  onRename: (newTerm: string) => Promise<{ ok: boolean; error?: string }>;
  onSetFavorite: (isFavorite: boolean) => void;
  onUpdateItem: (patch: { quantity?: number; unit?: string }) => void;
};

export const UserProductDetailScreen = ({
  item,
  userProduct,
  onRename,
  onSetFavorite,
  onUpdateItem
}: UserProductDetailScreenProps) => {
  const [termDraft, setTermDraft] = useState(userProduct.term);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [categories, setCategories] = useState<CategoryDto[]>([]);
  const [quantityDraft, setQuantityDraft] = useState(String(item.quantity));
  const [unitDraft, setUnitDraft] = useState(item.unit);

  // Resets the draft (and re-disables Save) whenever the parent confirms a
  // rename — either our own save, or this term changing under us.
  useEffect(() => {
    setTermDraft(userProduct.term);
  }, [userProduct.term]);

  useEffect(() => {
    setQuantityDraft(String(item.quantity));
    setUnitDraft(item.unit);
  }, [item.quantity, item.unit]);

  useEffect(() => {
    let active = true;
    apiRequest<{ categories: CategoryDto[] }>('/categories')
      .then((response) => {
        if (active) setCategories(response.categories ?? []);
      })
      .catch(() => {
        // Category badges are a nice-to-have — staying empty on failure is fine.
      });
    return () => {
      active = false;
    };
  }, []);

  const isSystemOwned = userProduct.owner_type === 'system';
  const trimmedTerm = termDraft.trim();
  const canSaveTerm = !isSystemOwned && !saving && trimmedTerm !== '' && trimmedTerm !== userProduct.term;

  const handleSaveTerm = async () => {
    setSaving(true);
    setErrorMessage(null);
    try {
      const result = await onRename(trimmedTerm);
      if (!result.ok) {
        setErrorMessage(result.error ?? 'Преименуването е неуспешно.');
      }
    } finally {
      setSaving(false);
    }
  };

  const commitQuantityUnit = () => {
    const quantity = Number(quantityDraft);
    const trimmedUnit = unitDraft.trim();
    const patch: { quantity?: number; unit?: string } = {};

    if (!Number.isNaN(quantity) && quantity > 0 && quantity !== item.quantity) {
      patch.quantity = quantity;
    }
    if (trimmedUnit && trimmedUnit !== item.unit) {
      patch.unit = trimmedUnit;
    }

    if (Object.keys(patch).length > 0) {
      onUpdateItem(patch);
    }
  };

  const categoryNames = (userProduct.category_ids ?? [])
    .map((categoryId) => categories.find((category) => category.id === categoryId)?.name)
    .filter((name): name is string => Boolean(name));

  return (
    <div className="addsearch" data-testid="user-product-detail">
      <div className="addbar">
        <input
          aria-label="Термин"
          value={termDraft}
          onChange={(event) => setTermDraft(event.target.value)}
          disabled={isSystemOwned}
          className="addbar__field"
        />
        <button
          type="button"
          onClick={() => void handleSaveTerm()}
          disabled={!canSaveTerm}
          className="iconbtn"
        >
          Запази
        </button>
        <button
          type="button"
          aria-pressed={Boolean(userProduct.is_favorite)}
          aria-label={userProduct.is_favorite ? 'Премахни от любими' : 'Добави в любими'}
          disabled={isSystemOwned}
          onClick={() => onSetFavorite(!userProduct.is_favorite)}
          className="iconbtn"
        >
          {userProduct.is_favorite ? '♥' : '♡'}
        </button>
      </div>

      {errorMessage ? (
        <p role="alert" style={{ color: 'var(--danger)', fontSize: 'var(--fs-sm)' }}>
          {errorMessage}
        </p>
      ) : null}

      {categoryNames.length > 0 ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {categoryNames.map((name) => (
            <span key={name} className="git" style={{ padding: '4px 10px' }}>
              {name}
            </span>
          ))}
        </div>
      ) : null}

      <div className="addbar">
        <input
          aria-label="Количество"
          value={quantityDraft}
          onChange={(event) => setQuantityDraft(event.target.value)}
          onBlur={commitQuantityUnit}
          className="addbar__field"
          style={{ flex: '0 0 64px' }}
        />
        <input
          aria-label="Мерна единица"
          value={unitDraft}
          onChange={(event) => setUnitDraft(event.target.value)}
          onBlur={commitQuantityUnit}
          className="addbar__field"
        />
      </div>
    </div>
  );
};
