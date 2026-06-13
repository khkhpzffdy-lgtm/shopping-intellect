type EmptyStateProps = {
  context: 'no-lists';
};

export const EmptyState = ({ context }: EmptyStateProps) => {
  if (context !== 'no-lists') {
    return null;
  }

  return (
    <section className="rounded-[2rem] border border-white/60 bg-white/80 p-8 shadow-shell">
      <p className="text-sm font-semibold uppercase tracking-[0.2em] text-pine/70">
        Lists overview
      </p>
      <h2 className="mt-3 text-3xl font-semibold text-ink">No lists yet</h2>
      <p className="mt-3 max-w-xl text-base leading-7 text-ink/70">
        Your shared planning space is ready. The next slice will create real lists; for now the
        shell is proving the auth and reload loop.
      </p>
      <button
        type="button"
        className="mt-8 rounded-2xl bg-coral px-5 py-3 text-sm font-semibold text-white transition hover:brightness-105"
      >
        Create list
      </button>
    </section>
  );
};
