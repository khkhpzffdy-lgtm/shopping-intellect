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
      className="mx-auto max-w-5xl animate-pulse rounded-[2rem] border border-white/60 bg-white/70 p-6 shadow-shell"
    >
      <div className="mb-6 h-5 w-32 rounded-full bg-sand" />
      <div className="grid gap-4 md:grid-cols-[220px_1fr]">
        <div className="space-y-3 rounded-[1.5rem] bg-canvas/80 p-4">
          <div className="h-4 w-24 rounded-full bg-sand" />
          <div className="h-4 w-20 rounded-full bg-sand" />
          <div className="h-4 w-28 rounded-full bg-sand" />
        </div>
        <div className="rounded-[1.5rem] bg-canvas/80 p-6">
          <div className="mb-4 h-8 w-56 rounded-full bg-sand" />
          <div className="h-4 w-full rounded-full bg-sand" />
          <div className="mt-3 h-4 w-5/6 rounded-full bg-sand" />
          <div className="mt-8 h-12 w-40 rounded-2xl bg-sand" />
        </div>
      </div>
    </div>
  );
};
