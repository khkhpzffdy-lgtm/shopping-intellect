type EmptyStateProps = {
  context: 'no-lists';
  onCreate: () => void;
};

export const EmptyState = ({ context, onCreate }: EmptyStateProps) => {
  if (context !== 'no-lists') {
    return null;
  }

  return (
    <section
      className="p-8"
      style={{ background: 'var(--card)', borderRadius: 'var(--radius)', border: '1px solid var(--card-border)', boxShadow: 'var(--shadow)' }}
    >
      <p style={{ color: 'var(--accent)', fontSize: 'var(--fs-xs)', fontWeight: 600, letterSpacing: '0.16em', textTransform: 'uppercase' }}>
        Списъци
      </p>
      <h2 className="mt-3" style={{ color: 'var(--ink)', fontSize: 'var(--fs-display)', fontWeight: 600 }}>
        Все още нямаш списъци
      </h2>
      <p className="mt-3 max-w-xl" style={{ color: 'var(--ink-2)', fontSize: 'var(--fs-body)', lineHeight: 1.6 }}>
        Започни с име по-горе и първият ти списък ще се появи веднага, дори офлайн.
      </p>
      <button
        type="button"
        onClick={onCreate}
        className="mt-8 px-5 py-3 transition hover:brightness-105"
        style={{ borderRadius: 'var(--radius-sm)', background: 'var(--accent)', color: 'var(--on-accent)', fontSize: 'var(--fs-sm)', fontWeight: 600 }}
      >
        Създай списък
      </button>
    </section>
  );
};
