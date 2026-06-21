import { useEffect, useState } from 'react';
import type { ListItemView, StoreProductRecord } from '../storage/db';

type StoreProductDetailScreenProps = {
  item: ListItemView;
  storeProduct: StoreProductRecord;
  canEdit: boolean;
  onRename: (newName: string) => Promise<{ ok: boolean; error?: string }>;
  onSetImageUrl: (imageUrl: string | null) => void;
  onSetBarcode: (barcodeValue: string) => void;
};

const ITEM_EMOJI = '🛒';

export const StoreProductDetailScreen = ({
  storeProduct,
  canEdit,
  onRename,
  onSetImageUrl,
  onSetBarcode
}: StoreProductDetailScreenProps) => {
  const [nameDraft, setNameDraft] = useState(storeProduct.name);
  const [imageDraft, setImageDraft] = useState(storeProduct.image_url ?? '');
  const [barcodeDraft, setBarcodeDraft] = useState(storeProduct.barcode ?? '');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Resets the drafts whenever the parent confirms a save — either our own,
  // or this product changing under us. Mirrors UserProductDetailScreen.
  useEffect(() => {
    setNameDraft(storeProduct.name);
  }, [storeProduct.name]);

  useEffect(() => {
    setImageDraft(storeProduct.image_url ?? '');
  }, [storeProduct.image_url]);

  useEffect(() => {
    setBarcodeDraft(storeProduct.barcode ?? '');
  }, [storeProduct.barcode]);

  const isCrawlerSourced = storeProduct.source !== 'user';
  const disabled = isCrawlerSourced || !canEdit;

  const commitName = async () => {
    const trimmed = nameDraft.trim();
    if (!trimmed || trimmed === storeProduct.name) {
      setNameDraft(storeProduct.name);
      return;
    }
    setErrorMessage(null);
    const result = await onRename(trimmed);
    if (!result.ok) {
      setErrorMessage(result.error ?? 'Преименуването е неуспешно.');
    }
  };

  const commitImage = () => {
    const trimmed = imageDraft.trim();
    if (trimmed === (storeProduct.image_url ?? '')) {
      return;
    }
    onSetImageUrl(trimmed || null);
  };

  const commitBarcode = () => {
    const trimmed = barcodeDraft.trim();
    if (!trimmed || trimmed === (storeProduct.barcode ?? '')) {
      setBarcodeDraft(storeProduct.barcode ?? '');
      return;
    }
    onSetBarcode(trimmed);
  };

  return (
    <div className="addsearch" data-testid="store-product-detail">
      <div className="hero">
        <span className="hero__emoji" aria-hidden="true">
          {ITEM_EMOJI}
        </span>
        <div className="hero__title">
          <input
            aria-label="Име"
            className="hero__name"
            value={nameDraft}
            onChange={(event) => setNameDraft(event.target.value)}
            onBlur={() => void commitName()}
            disabled={disabled}
          />
        </div>
        {storeProduct.source === 'user' ? (
          <p style={{ color: 'var(--ink-2)', fontSize: 'var(--fs-sm)', textAlign: 'center' }}>
            ръчно записан артикул, още не е намерен в магазин
          </p>
        ) : null}
        {!canEdit && !isCrawlerSourced ? (
          <p style={{ color: 'var(--ink-2)', fontSize: 'var(--fs-sm)', textAlign: 'center' }}>
            само създателят на този артикул може да го редактира
          </p>
        ) : null}
      </div>

      {errorMessage ? (
        <p role="alert" style={{ color: 'var(--danger)', fontSize: 'var(--fs-sm)', textAlign: 'center', marginTop: 8 }}>
          {errorMessage}
        </p>
      ) : null}

      <div className="group">
        <div className="group__head">
          <span className="group__title">Снимка</span>
        </div>
        <div className="qtygrid__cell">
          <div className="addbar">
            <input
              aria-label="Снимка (URL)"
              className="addbar__field"
              value={imageDraft}
              onChange={(event) => setImageDraft(event.target.value)}
              onBlur={commitImage}
              disabled={disabled}
              placeholder="https://..."
            />
          </div>
        </div>
      </div>

      <div className="group">
        <div className="group__head">
          <span className="group__title">Баркод</span>
        </div>
        <div className="qtygrid__cell">
          <div className="addbar">
            <input
              aria-label="Баркод"
              className="addbar__field"
              value={barcodeDraft}
              onChange={(event) => setBarcodeDraft(event.target.value)}
              onBlur={commitBarcode}
              disabled={disabled}
              placeholder="напр. 1234567890123"
            />
          </div>
        </div>
      </div>
    </div>
  );
};
