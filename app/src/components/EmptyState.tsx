type EmptyStateProps = {
  context: 'no-lists';
};

export const EmptyState = ({ context }: EmptyStateProps) => {
  if (context !== 'no-lists') {
    return null;
  }

  return (
    <section
      className="p-8"
      style={{ background: 'var(--card)', borderRadius: 'var(--radius)', border: '1px solid var(--card-border)', boxShadow: 'var(--shadow)' }}
    >
      <p style={{ color: 'var(--accent)', fontSize: 'var(--fs-xs)', fontWeight: 600, letterSpacing: '0.16em', textTransform: 'uppercase' }}>
        Lists overview
      </p>
      <h2 className="mt-3" style={{ color: 'var(--ink)', fontSize: 'var(--fs-display)', fontWeight: 600 }}>
        No lists yet
      </h2>
      <p className="mt-3 max-w-xl" style={{ color: 'var(--ink-2)', fontSize: 'var(--fs-body)', lineHeight: 1.6 }}>
        Your shared planning space is ready. The next slice will create real lists; for now the
        shell is proving the auth and reload loop.
      </p>
      <button
        type="button"
        className="mt-8 px-5 py-3 transition hover:brightness-105"
        style={{ borderRadius: 'var(--radius-sm)', background: 'var(--accent)', color: 'var(--on-accent)', fontSize: 'var(--fs-sm)', fontWeight: 600 }}
      >
        Create list
      </button>
    </section>
  );
};
