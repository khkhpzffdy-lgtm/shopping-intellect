type SkeletonLoaderProps = {
  shape?: 'card';
};

export const SkeletonLoader = ({ shape = 'card' }: SkeletonLoaderProps) => {
  if (shape !== 'card') {
    return null;
  }

  return (
    <div
      aria-label="Loading shell"
      className="mx-auto max-w-5xl animate-pulse p-6"
      style={{ background: 'var(--card)', border: '1px solid var(--card-border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)' }}
    >
      <div className="mb-6 h-5 w-32 rounded-full" style={{ background: 'var(--input)' }} />
      <div className="grid gap-4 md:grid-cols-[220px_1fr]">
        <div className="space-y-3 p-4" style={{ background: 'var(--card-2)', borderRadius: 'var(--radius-sm)' }}>
          <div className="h-4 w-24 rounded-full" style={{ background: 'var(--input)' }} />
          <div className="h-4 w-20 rounded-full" style={{ background: 'var(--input)' }} />
          <div className="h-4 w-28 rounded-full" style={{ background: 'var(--input)' }} />
        </div>
        <div className="p-6" style={{ background: 'var(--card-2)', borderRadius: 'var(--radius-sm)' }}>
          <div className="mb-4 h-8 w-56 rounded-full" style={{ background: 'var(--input)' }} />
          <div className="h-4 w-full rounded-full" style={{ background: 'var(--input)' }} />
          <div className="mt-3 h-4 w-5/6 rounded-full" style={{ background: 'var(--input)' }} />
          <div className="mt-8 h-12 w-40 rounded-2xl" style={{ background: 'var(--input)' }} />
        </div>
      </div>
    </div>
  );
};
