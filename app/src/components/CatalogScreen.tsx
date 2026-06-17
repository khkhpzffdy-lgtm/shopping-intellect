import { useEffect, useState } from 'react';
import { apiRequest } from '../api/client';
import { SkeletonLoader } from './SkeletonLoader';

type CategoryDto = {
  id: string;
  slug: string;
  name: string;
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

  return (
    <div className="glist">
      {categories.map((category) => (
        <article key={category.id} className="git">
          <div className="git__main">
            <div className="git__name">{category.name}</div>
          </div>
        </article>
      ))}
    </div>
  );
};
