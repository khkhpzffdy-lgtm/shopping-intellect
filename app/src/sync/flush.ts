import { getQueuedMutations, markMutationInFlight } from '../storage/db';
import { sendMutation } from './sendMutation';

type FlushResult = {
  failed: number;
  processed: number;
  succeeded: number;
};

let activeFlush: Promise<FlushResult> | null = null;

const drainQueuedMutations = async (): Promise<FlushResult> => {
  const queuedMutations = await getQueuedMutations();
  let failed = 0;
  let succeeded = 0;

  for (const mutation of queuedMutations) {
    const claimedMutation = await markMutationInFlight(mutation.client_uuid);
    if (!claimedMutation) {
      continue;
    }

    try {
      await sendMutation(claimedMutation);
      succeeded += 1;
    } catch {
      failed += 1;
    }
  }

  return {
    failed,
    processed: queuedMutations.length,
    succeeded
  };
};

export const flushQueuedMutations = () => {
  if (activeFlush) {
    return activeFlush;
  }

  activeFlush = drainQueuedMutations().finally(() => {
    activeFlush = null;
  });

  return activeFlush;
};
