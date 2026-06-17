import { SyncFailedIcon, SyncPendingIcon } from './icons';

type SyncStatusIndicatorProps = {
  pending: number;
  failed: number;
};

export const SyncStatusIndicator = ({ pending, failed }: SyncStatusIndicatorProps) => {
  if (failed > 0) {
    return (
      <span className="sync-icon sync-icon--failed" role="img" aria-label="Грешка при синхронизация" title="Грешка при синхронизация">
        <SyncFailedIcon />
      </span>
    );
  }

  if (pending > 0) {
    return (
      <span className="sync-icon sync-icon--pending" role="img" aria-label="Синхронизира се" title="Синхронизира се">
        <SyncPendingIcon />
      </span>
    );
  }

  return null;
};
