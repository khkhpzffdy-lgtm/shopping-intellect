import { beforeEach, expect, test } from 'vitest';
import { clearDatabase, enqueueMutation, getMutationStatusCounts } from '../storage/db';

beforeEach(async () => {
  await clearDatabase();
});

test('getMutationStatusCounts produces independent pending/failed counts per entity', async () => {
  await enqueueMutation({
    client_uuid: 'mut-pending',
    endpoint: '/lists',
    method: 'POST',
    created_at: '2026-06-17T00:00:00.000Z',
    attempts: 0,
    status: 'pending',
    entity_client_uuid: 'entity-a'
  });
  await enqueueMutation({
    client_uuid: 'mut-failed',
    endpoint: '/lists',
    method: 'POST',
    created_at: '2026-06-17T00:00:00.000Z',
    attempts: 1,
    status: 'failed',
    entity_client_uuid: 'entity-b'
  });

  const counts = await getMutationStatusCounts();

  expect(counts['entity-a']).toEqual({ pending: 1, failed: 0 });
  expect(counts['entity-b']).toEqual({ pending: 0, failed: 1 });
});
