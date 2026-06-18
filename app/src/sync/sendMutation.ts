import { apiRequest } from '../api/client';
import { getList, markMutationDone, markMutationFailed, type MutationQueueRecord } from '../storage/db';
import { applyMutationSuccess } from './applyMutationSuccess';

export const resolveEndpoint = async (mutation: MutationQueueRecord) => {
  if (mutation.method === 'POST') {
    const itemMatch = mutation.endpoint.match(/^\/lists\/([^/]+)\/items$/);
    if (!itemMatch) {
      return mutation.endpoint;
    }

    const list = await getList(itemMatch[1]);
    if (!list?.id) {
      return mutation.endpoint;
    }

    return `/lists/${list.id}/items`;
  }

  if (mutation.method === 'DELETE' || mutation.method === 'PATCH') {
    const listMatch = mutation.endpoint.match(/^\/lists\/([^/]+)$/);
    if (!listMatch) {
      return mutation.endpoint;
    }

    const list = await getList(listMatch[1]);
    if (!list?.id) {
      return mutation.endpoint;
    }

    return `/lists/${list.id}`;
  }

  return mutation.endpoint;
};

export const sendMutation = async (mutation: MutationQueueRecord): Promise<void> => {
  try {
    const response = await apiRequest(await resolveEndpoint(mutation), {
      method: mutation.method,
      body: mutation.body,
      authenticated: true
    });

    await applyMutationSuccess(mutation, response);
    await markMutationDone(mutation.client_uuid);
  } catch (error) {
    await markMutationFailed(mutation.client_uuid);
    throw error;
  }
};
