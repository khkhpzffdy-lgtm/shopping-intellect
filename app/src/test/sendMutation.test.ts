import { beforeEach, describe, expect, test, vi } from 'vitest';
import { clearDatabase, enqueueMutation, getMutation, putList, putStoreProduct } from '../storage/db';
import { flushQueuedMutations } from '../sync/flush';
import { resolveEndpoint, sendMutation } from '../sync/sendMutation';

vi.mock('../sync/sendMutation', async () => {
  const actual = await vi.importActual<typeof import('../sync/sendMutation')>('../sync/sendMutation');
  return {
    ...actual,
    sendMutation: vi.fn()
  };
});

const mockedSendMutation = vi.mocked(sendMutation);

describe('sendMutation is the single dispatch path', () => {
  beforeEach(async () => {
    mockedSendMutation.mockReset();
    mockedSendMutation.mockResolvedValue(undefined);
    await clearDatabase();
  });

  test('flushQueuedMutations routes every queued mutation through sendMutation exactly once', async () => {
    await putList({
      client_uuid: 'list-a',
      name: 'A',
      owner_type: 'user',
      owner_id: 1,
      updated_at: '2026-06-17T10:00:00.000Z'
    });
    await putList({
      client_uuid: 'list-b',
      name: 'B',
      owner_type: 'user',
      owner_id: 1,
      updated_at: '2026-06-17T10:01:00.000Z'
    });
    await enqueueMutation({
      client_uuid: 'list-a',
      endpoint: '/lists',
      method: 'POST',
      body: { client_uuid: 'list-a', name: 'A' },
      created_at: '2026-06-17T10:00:00.000Z',
      attempts: 0,
      status: 'pending',
      entity_client_uuid: 'list-a'
    });
    await enqueueMutation({
      client_uuid: 'list-b',
      endpoint: '/lists',
      method: 'POST',
      body: { client_uuid: 'list-b', name: 'B' },
      created_at: '2026-06-17T10:01:00.000Z',
      attempts: 0,
      status: 'pending',
      entity_client_uuid: 'list-b'
    });

    await flushQueuedMutations();

    expect(mockedSendMutation).toHaveBeenCalledTimes(2);
    expect(mockedSendMutation).toHaveBeenCalledWith(expect.objectContaining({ client_uuid: 'list-a' }));
    expect(mockedSendMutation).toHaveBeenCalledWith(expect.objectContaining({ client_uuid: 'list-b' }));
  });

  test('flushQueuedMutations never calls apiRequest directly — only through sendMutation', async () => {
    await putList({
      client_uuid: 'list-c',
      name: 'C',
      owner_type: 'user',
      owner_id: 1,
      updated_at: '2026-06-17T10:02:00.000Z'
    });
    await enqueueMutation({
      client_uuid: 'list-c',
      endpoint: '/lists',
      method: 'POST',
      body: { client_uuid: 'list-c', name: 'C' },
      created_at: '2026-06-17T10:02:00.000Z',
      attempts: 0,
      status: 'pending',
      entity_client_uuid: 'list-c'
    });

    const result = await flushQueuedMutations();

    expect(result).toEqual({ failed: 0, processed: 1, succeeded: 1 });
    expect(await getMutation('list-c')).toMatchObject({ status: 'in_flight' });
  });
});

describe('resolveEndpoint resolves a queued list-delete mutation to the real server id', () => {
  beforeEach(async () => {
    await clearDatabase();
  });

  test('resolves /lists/{clientUuid} to /lists/{serverId} once the list has synced', async () => {
    await putList({
      client_uuid: 'list-d',
      id: '99',
      name: 'D',
      owner_type: 'user',
      owner_id: 1,
      updated_at: '2026-06-17T10:03:00.000Z'
    });

    const endpoint = await resolveEndpoint({
      client_uuid: 'mut-delete-list-d',
      endpoint: '/lists/list-d',
      method: 'DELETE',
      created_at: '2026-06-17T10:03:00.000Z',
      attempts: 0,
      status: 'pending',
      entity_client_uuid: 'list-d'
    });

    expect(endpoint).toBe('/lists/99');
  });

  test('falls back to the literal endpoint if no server id is known yet', async () => {
    const endpoint = await resolveEndpoint({
      client_uuid: 'mut-delete-list-e',
      endpoint: '/lists/list-e',
      method: 'DELETE',
      created_at: '2026-06-17T10:04:00.000Z',
      attempts: 0,
      status: 'pending',
      entity_client_uuid: 'list-e'
    });

    expect(endpoint).toBe('/lists/list-e');
  });

  test('resolves a queued PATCH list-rename mutation to the real server id', async () => {
    await putList({
      client_uuid: 'list-f',
      id: '101',
      name: 'F',
      owner_type: 'user',
      owner_id: 1,
      updated_at: '2026-06-17T10:05:00.000Z'
    });

    const endpoint = await resolveEndpoint({
      client_uuid: 'mut-rename-list-f',
      endpoint: '/lists/list-f',
      method: 'PATCH',
      body: { name: 'New name' },
      created_at: '2026-06-17T10:05:00.000Z',
      attempts: 0,
      status: 'pending',
      entity_client_uuid: 'list-f'
    });

    expect(endpoint).toBe('/lists/101');
  });

  test('resolves a queued PATCH store-product mutation to the real server id once synced', async () => {
    await putStoreProduct({
      client_uuid: 'sp-g',
      id: '55',
      source: 'user',
      name: 'G',
      created_at: '2026-06-21T10:00:00.000Z'
    });

    const endpoint = await resolveEndpoint({
      client_uuid: 'mut-barcode-sp-g',
      endpoint: '/store-products/sp-g',
      method: 'PATCH',
      body: { barcode_value: '123' },
      created_at: '2026-06-21T10:00:00.000Z',
      attempts: 0,
      status: 'pending',
      entity_client_uuid: 'sp-g'
    });

    expect(endpoint).toBe('/store-products/55');
  });

  test('falls back to the literal store-product endpoint if no server id is known yet', async () => {
    const endpoint = await resolveEndpoint({
      client_uuid: 'mut-barcode-sp-h',
      endpoint: '/store-products/sp-h',
      method: 'PATCH',
      body: { barcode_value: '123' },
      created_at: '2026-06-21T10:01:00.000Z',
      attempts: 0,
      status: 'pending',
      entity_client_uuid: 'sp-h'
    });

    expect(endpoint).toBe('/store-products/sp-h');
  });
});
