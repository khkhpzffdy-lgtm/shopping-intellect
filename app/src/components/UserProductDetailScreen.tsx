import { useEffect, useState } from 'react';
import { apiRequest } from '../api/client';
import { CategoryPicker, type CategoryDto } from './CategoryPicker';
import { HeartFilledIcon, HeartOutlineIcon } from './icons';
import type { ListItemView, UserProductRecord } from '../storage/db';

type UserProductDetailScreenProps = {
  // Absent when opened standalone from Catalog rather than from a list item
  // — quantity/unit live on the list_item, not the term, so that section
  // simply doesn't render in that case.
  item?: ListItemView;
  userProduct: UserProductRecord;
  onRename: (newTerm: string) => Promise<{ ok: boolean; error?: string }>;
  onSetFavorite: (isFavorite: boolean) => void;
  onSetCategories: (categoryIds: string[]) => void;
  onUpdateItem?: (patch: { quantity?: number; unit?: string }) => void;
};

const ITEM_EMOJI = '🛒';

export const UserProductDetailScreen = ({
  item,
  userProduct,
  onRename,
  onSetFavorite,
  onSetCategories,
  onUpdateItem
}: UserProductDetailScreenProps) => {
  const [termDraft, setTermDraft] = useState(userProduct.term);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [categories, setCategories] = useState<CategoryDto[]>([]);
  const [unitDraft, setUnitDraft] = useState(item?.unit ?? '');
  const [pickerOpen, setPickerOpen] = useState(false);

  // Resets the draft whenever the parent confirms a rename — either our own
  // save, or this term changing under us.
  useEffect(() => {
    setTermDraft(userProduct.term);
  }, [userProduct.term]);

  useEffect(() => {
    setUnitDraft(item?.unit ?? '');
  }, [item?.unit]);

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

  const commitTerm = async () => {
    const trimmed = termDraft.trim();
    if (!trimmed || trimmed === userProduct.term) {
      setTermDraft(userProduct.term);
      return;
    }
    setErrorMessage(null);
    const result = await onRename(trimmed);
    if (!result.ok) {
      setErrorMessage(result.error ?? 'Преименуването е неуспешно.');
    }
  };

  const commitUnit = () => {
    if (!item || !onUpdateItem) return;
    const trimmedUnit = unitDraft.trim();
    if (trimmedUnit && trimmedUnit !== item.unit) {
      onUpdateItem({ unit: trimmedUnit });
    } else {
      setUnitDraft(item.unit);
    }
  };

  const categoryIds = userProduct.category_ids ?? [];
  const categoryNames = categoryIds
    .map((categoryId) => categories.find((category) => category.id === categoryId)?.name)
    .filter((name): name is string => Boolean(name));

  if (pickerOpen) {
    return (
      <div data-testid="user-product-detail">
        <div className="appbar">
          <button type="button" onClick={() => setPickerOpen(false)} className="iconbtn" aria-label="Затвори">
            ←
          </button>
          <div className="appbar__title">Категории</div>
        </div>
        <CategoryPicker
          categories={categories}
          selectedIds={categoryIds}
          onSave={(newCategoryIds) => {
            onSetCategories(newCategoryIds);
            setPickerOpen(false);
          }}
        />
      </div>
    );
  }

  return (
    <div className="addsearch" data-testid="user-product-detail">
      <div className="hero">
        <span className="hero__emoji" aria-hidden="true">
          {ITEM_EMOJI}
        </span>
        <div className="hero__title">
          <input
            aria-label="Термин"
            className="hero__name"
            value={termDraft}
            onChange={(event) => setTermDraft(event.target.value)}
            onBlur={() => void commitTerm()}
            disabled={isSystemOwned}
          />
          <button
            type="button"
            className="hero__fav"
            aria-pressed={Boolean(userProduct.is_favorite)}
            aria-label={userProduct.is_favorite ? 'Премахни от любими' : 'Добави в любими'}
            disabled={isSystemOwned}
            onClick={() => onSetFavorite(!userProduct.is_favorite)}
          >
            {userProduct.is_favorite ? <HeartFilledIcon /> : <HeartOutlineIcon />}
          </button>
        </div>
        {categoryNames.length > 0 || !isSystemOwned ? (
          <div className="hero__row">
            {categoryNames.map((name) => (
              <span key={name} className="catchip">
                {name}
              </span>
            ))}
            {!isSystemOwned ? (
              <button type="button" className="catchip catchip--add" onClick={() => setPickerOpen(true)}>
                {categoryNames.length > 0 ? 'Промени' : '+ Категория'}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {errorMessage ? (
        <p role="alert" style={{ color: 'var(--danger)', fontSize: 'var(--fs-sm)', textAlign: 'center', marginTop: 8 }}>
          {errorMessage}
        </p>
      ) : null}

      {item && onUpdateItem ? (
        <div className="group">
          <div className="group__head">
            <span className="group__title">Количество</span>
          </div>
          <div className="qtygrid">
            <div className="qtygrid__cell">
              <div className="qtygrid__label">Брой</div>
              <div className="stepper">
                <button
                  type="button"
                  aria-label="Намали количеството"
                  disabled={item.quantity <= 1}
                  onClick={() => onUpdateItem({ quantity: item.quantity - 1 })}
                >
                  −
                </button>
                <span className="stepper__v">{item.quantity}</span>
                <button
                  type="button"
                  aria-label="Увеличи количеството"
                  onClick={() => onUpdateItem({ quantity: item.quantity + 1 })}
                >
                  +
                </button>
              </div>
            </div>
            <div className="qtygrid__cell">
              <div className="qtygrid__label">Мярка</div>
              <input
                aria-label="Мярка"
                className="qtygrid__val"
                value={unitDraft}
                onChange={(event) => setUnitDraft(event.target.value)}
                onBlur={commitUnit}
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
