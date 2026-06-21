import { useState } from 'react';

export type CategoryDto = {
  id: string;
  name: string;
  parent_id: string | null;
};

type CategoryPickerProps = {
  categories: CategoryDto[];
  selectedIds: string[];
  onSave: (categoryIds: string[]) => void;
};

export const CategoryPicker = ({ categories, selectedIds, onSave }: CategoryPickerProps) => {
  const [checked, setChecked] = useState<Set<string>>(new Set(selectedIds));

  const roots = categories.filter((category) => !category.parent_id);
  const childrenOf = (parentId: string) => categories.filter((category) => category.parent_id === parentId);

  const toggle = (id: string) => {
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <div className="addsearch" data-testid="category-picker">
      <div className="glist">
        {roots.map((root) => (
          <div key={root.id}>
            <label className="catpick__row catpick__row--parent">
              <input type="checkbox" checked={checked.has(root.id)} onChange={() => toggle(root.id)} />
              {root.name}
            </label>
            {childrenOf(root.id).map((child) => (
              <label key={child.id} className="catpick__row catpick__row--child">
                <input type="checkbox" checked={checked.has(child.id)} onChange={() => toggle(child.id)} />
                {child.name}
              </label>
            ))}
          </div>
        ))}
      </div>
      <button
        type="button"
        className="addsearch__manualform-submit"
        style={{ marginTop: 16 }}
        onClick={() => onSave(Array.from(checked))}
      >
        Готово
      </button>
    </div>
  );
};
