import { useEffect, useState } from 'react';
import { apiRequest } from '../api/client';
import { SkeletonLoader } from './SkeletonLoader';

type CategoryDto = {
  id: string;
  slug: string;
  name: string;
  parent_id?: string | null;
};

type CatalogScreenProps = {
  isActive?: boolean;
};

export const CatalogScreen = ({ isActive = true }: CatalogScreenProps) => {
  const [categories, setCategories] = useState<CategoryDto[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    if (!isActive) return;

    let active = true;

    const loadCategories = async () => {
      setStatus('loading');
      try {
        const response = await apiRequest<{ categories: CategoryDto[] }>('/categories');
        if (active) {
          setCategories(response.categories ?? []);
          setStatus('ready');
        }
      } catch {
        if (active) setStatus('error');
      }
    };

    void loadCategories();

    return () => {
      active = false;
    };
  }, [isActive]);

  if (status === 'loading') {
    return <SkeletonLoader shape="card" />;
  }

  if (status === 'error') {
    return (
      <section
        className="p-6"
        style={{ background: 'var(--card)', borderRadius: 'var(--radius)', border: '1px solid var(--card-border)' }}
      >
        <p style={{ color: 'var(--ink-2)', fontSize: 'var(--fs-body)' }}>
          Каталогът не може да се зареди в момента.
        </p>
      </section>
    );
  }

  if (categories.length === 0) {
    return (
      <section
        className="p-6"
        style={{ background: 'var(--card)', borderRadius: 'var(--radius)', border: '1px solid var(--card-border)' }}
      >
        <p style={{ color: 'var(--ink-2)', fontSize: 'var(--fs-body)' }}>Все още няма категории.</p>
      </section>
    );
  }

  const roots = categories.filter((category) => !category.parent_id);
  const childrenOf = (parentId: string) => categories.filter((category) => category.parent_id === parentId);

  return (
    <div className="glist">
      {roots.map((root) => (
        <div key={root.id}>
          <article className="git">
            <div className="git__main">
              <div className="git__name">{root.name}</div>
            </div>
          </article>
          {childrenOf(root.id).map((child) => (
            <article key={child.id} className="git" style={{ paddingLeft: 32 }}>
              <div className="git__main">
                <div className="git__name" style={{ fontWeight: 500, color: 'var(--ink-2)' }}>
                  {child.name}
                </div>
              </div>
            </article>
          ))}
        </div>
      ))}
    </div>
  );
};
