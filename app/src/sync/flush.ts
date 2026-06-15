import { apiRequest } from '../api/client';
import {
  getList,
  getQueuedMutations,
  markMutationDone,
  markMutationFailed,
  markMutationInFlight,
  type MutationQueueRecord
} from '../storage/db';
import { applyMutationSuccess } from './applyMutationSuccess';

type FlushResult = {
  failed: number;
  processed: number;
  succeeded: number;
};

let activeFlush: Promise<FlushResult> | null = null;

const resolveEndpoint = async (mutation: MutationQueueRecord) => {
  if (mutation.method !== 'POST') {
    return mutation.endpoint;
  }

  const itemMatch = mutation.endpoint.match(/^\/lists\/([^/]+)\/items$/);
  if (!itemMatch) {
    return mutation.endpoint;
  }

  const list = await getList(itemMatch[1]);
  if (!list?.id) {
    return mutation.endpoint;
  }

  return `/lists/${list.id}/items`;
};

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
      const response = await apiRequest(await resolveEndpoint(claimedMutation), {
        method: claimedMutation.method,
        body: claimedMutation.body,
        authenticated: true
      });

      await applyMutationSuccess(claimedMutation, response);
      await markMutationDone(claimedMutation.client_uuid);
      succeeded += 1;
    } catch {
      await markMutationFailed(claimedMutation.client_uuid);
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
