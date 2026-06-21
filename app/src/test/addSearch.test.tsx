import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { AddSearchScreen } from '../components/AddSearchScreen';
import { apiRequest } from '../api/client';
import { clearDatabase, putUserProduct } from '../storage/db';
import { useAuthStore } from '../store/auth';

vi.mock('../api/client', () => ({
  apiRequest: vi.fn()
}));

const mockedApiRequest = vi.mocked(apiRequest);

const makeToken = (payload: Record<string, unknown>) => {
  const base64 = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `header.${base64}.signature`;
};

const mockList = {
  client_uuid: 'list-1',
  id: '42',
  name: 'Тест',
  owner_type: 'user' as const,
  owner_id: 7,
  updated_at: '2026-06-17T10:00:00.000Z'
};

beforeEach(async () => {
  mockedApiRequest.mockReset();
  await clearDatabase();
  useAuthStore.getState().setSession({
    // makeToken()'s payload goes through plain btoa(), which throws on any
    // non-Latin1 character (real JS behavior, not an environment quirk) —
    // keep it ASCII-only. The Cyrillic display name below is what the UI
    // actually reads; setSession()'s explicit `user` wins over anything
    // decoded from the token.
    accessToken: makeToken({ user_id: 7, family_ids: [], display_name: 'Iva' }),
    expiresIn: 900,
    user: { id: 7, displayName: 'Ива', familyIds: [] }
  });
  // Default: /user-products returns empty
  mockedApiRequest.mockResolvedValue({ user_products: [] });
});

describe('AddSearchScreen — no selected list', () => {
  test('shows graceful empty state when no list is open', () => {
    render(<AddSearchScreen selectedList={null} onItemAdded={() => {}} />);
    expect(screen.getByText('Отвори списък, за да добавиш')).toBeInTheDocument();
  });
});

describe('AddSearchScreen — search', () => {
  test('shows matching term when query matches local user_products', async () => {
    await putUserProduct({
      client_uuid: 'up-1',
      owner_type: 'user',
      owner_id: 7,
      term: 'мляко',
      normalized_term: 'мляко',
      created_at: '2026-06-17T09:00:00.000Z'
    });
    // After loadTerms, allTerms is populated; user-products endpoint is mocked empty,
    // so the local db record must show up via the put above.
    // Override the mock to let PUT succeed and return empty (local record already exists)
    mockedApiRequest.mockResolvedValueOnce({ user_products: [
      { client_uuid: 'up-1', owner_type: 'user', owner_id: 7, term: 'мляко', normalized_term: 'мляко', created_at: '2026-06-17T09:00:00.000Z' }
    ] });
    mockedApiRequest.mockResolvedValue({ item: { id: '99' }, user_product: { id: '55' } });

    render(<AddSearchScreen selectedList={mockList} onItemAdded={() => {}} />);

    const input = await screen.findByLabelText('Търси термин');
    await userEvent.type(input, 'мляко');

    expect(await screen.findByText('мляко')).toBeInTheDocument();
  });

  test('shows both "добави нов термин" and "добави конкретен артикул" even when a term matches', async () => {
    await putUserProduct({
      client_uuid: 'up-1',
      owner_type: 'user',
      owner_id: 7,
      term: 'мляко',
      normalized_term: 'мляко',
      created_at: '2026-06-17T09:00:00.000Z'
    });
    mockedApiRequest.mockResolvedValueOnce({ user_products: [
      { client_uuid: 'up-1', owner_type: 'user', owner_id: 7, term: 'мляко', normalized_term: 'мляко', created_at: '2026-06-17T09:00:00.000Z' }
    ] });

    render(<AddSearchScreen selectedList={mockList} onItemAdded={() => {}} />);

    const input = await screen.findByLabelText('Търси термин');
    await userEvent.type(input, 'мляко');

    expect(await screen.findByText('мляко')).toBeInTheDocument();
    expect(screen.getByTestId('add-new-term')).toBeInTheDocument();
    expect(screen.getByTestId('add-specific-item')).toBeInTheDocument();
  });

  test('shows a system-owned seeded term in search results without the owner ever creating it', async () => {
    mockedApiRequest.mockResolvedValueOnce({ user_products: [
      {
        client_uuid: 'seed-uuid-1',
        owner_type: 'system',
        owner_id: 0,
        term: 'Домати',
        normalized_term: 'домати',
        created_at: '2026-06-19T09:00:00.000Z',
        is_global_default: true
      }
    ] });

    render(<AddSearchScreen selectedList={mockList} onItemAdded={() => {}} />);

    const input = await screen.findByLabelText('Търси термин');
    await userEvent.type(input, 'домати');

    expect(await screen.findByText('Домати')).toBeInTheDocument();
  });

  test('shows "добави нов" affordance when query has no match', async () => {
    mockedApiRequest.mockResolvedValueOnce({ user_products: [] });

    render(<AddSearchScreen selectedList={mockList} onItemAdded={() => {}} />);

    const input = await screen.findByLabelText('Търси термин');
    await userEvent.type(input, 'нещо-ново-абв');

    expect(await screen.findByTestId('add-new-term')).toBeInTheDocument();
    expect(screen.getByTestId('add-new-term')).toHaveTextContent('нещо-ново-абв');
  });

  test('shows QuickAddSections when query is empty', async () => {
    render(<AddSearchScreen selectedList={mockList} onItemAdded={() => {}} />);

    await screen.findByLabelText('Търси термин');

    expect(screen.getByText('Любими')).toBeInTheDocument();
    expect(screen.getByText('Скорошни')).toBeInTheDocument();
    expect(screen.getByText('Чести')).toBeInTheDocument();
  });

  test('selecting an existing term posts to /lists/{id}/items with user_product_id and calls onItemAdded', async () => {
    await putUserProduct({
      client_uuid: 'up-2',
      id: '55',
      owner_type: 'user',
      owner_id: 7,
      term: 'хляб',
      normalized_term: 'хляб',
      created_at: '2026-06-17T09:00:00.000Z'
    });

    mockedApiRequest
      .mockResolvedValueOnce({ user_products: [
        { client_uuid: 'up-2', id: '55', owner_type: 'user', owner_id: 7, term: 'хляб', normalized_term: 'хляб', created_at: '2026-06-17T09:00:00.000Z' }
      ] })
      .mockResolvedValueOnce({ item: { id: '100' }, user_product: { id: '55' } });

    const onItemAdded = vi.fn();
    render(<AddSearchScreen selectedList={mockList} onItemAdded={onItemAdded} />);

    const input = await screen.findByLabelText('Търси термин');
    await userEvent.type(input, 'хляб');

    const resultBtn = await screen.findByText('хляб');
    await userEvent.click(resultBtn);

    await waitFor(() => expect(onItemAdded).toHaveBeenCalled());

    const postCall = mockedApiRequest.mock.calls.find(
      (call) => call[0] === '/lists/42/items' && (call[1] as { method?: string })?.method === 'POST'
    );
    expect(postCall).toBeDefined();
    const body = (postCall![1] as { body?: { user_product_id?: string } })?.body;
    expect(body?.user_product_id).toBe('55');
  });

  test('"добави нов" posts inline user_product with term and client_uuid and calls onItemAdded', async () => {
    mockedApiRequest
      .mockResolvedValueOnce({ user_products: [] })
      .mockResolvedValueOnce({ item: { id: '101' }, user_product: { id: '66' } });

    const onItemAdded = vi.fn();
    render(<AddSearchScreen selectedList={mockList} onItemAdded={onItemAdded} />);

    const input = await screen.findByLabelText('Търси термин');
    await userEvent.type(input, 'извара');

    const addNewBtn = await screen.findByTestId('add-new-term');
    await userEvent.click(addNewBtn);

    await waitFor(() => expect(onItemAdded).toHaveBeenCalled());

    const postCall = mockedApiRequest.mock.calls.find(
      (call) => call[0] === '/lists/42/items' && (call[1] as { method?: string })?.method === 'POST'
    );
    expect(postCall).toBeDefined();
    const body = (postCall![1] as { body?: { user_product?: { term?: string; client_uuid?: string } } })?.body;
    expect(body?.user_product?.term).toBe('извара');
    expect(body?.user_product?.client_uuid).toBeTruthy();
  });

  test('"добави конкретен артикул" shows a form with name required, photo/barcode optional', async () => {
    mockedApiRequest.mockResolvedValueOnce({ user_products: [] });

    render(<AddSearchScreen selectedList={mockList} onItemAdded={() => {}} />);

    const input = await screen.findByLabelText('Търси термин');
    await userEvent.type(input, 'мляко данон');

    const addSpecificBtn = await screen.findByTestId('add-specific-item');
    await userEvent.click(addSpecificBtn);

    expect(await screen.findByTestId('manual-store-product-form')).toBeInTheDocument();
    expect(screen.getByLabelText('Име на артикула')).toHaveValue('мляко данон');
    expect(screen.getByLabelText('Снимка (URL)')).toBeInTheDocument();
    expect(screen.getByLabelText('Баркод')).toBeInTheDocument();
  });

  test('submitting the manual form posts store_product with name/image and calls onItemAdded', async () => {
    mockedApiRequest
      .mockResolvedValueOnce({ user_products: [] })
      .mockResolvedValueOnce({ item: { id: '102' }, store_product: { id: '77' } });

    const onItemAdded = vi.fn();
    render(<AddSearchScreen selectedList={mockList} onItemAdded={onItemAdded} />);

    const input = await screen.findByLabelText('Търси термин');
    await userEvent.type(input, 'мляко данон 2%');

    await userEvent.click(await screen.findByTestId('add-specific-item'));
    await userEvent.type(screen.getByLabelText('Снимка (URL)'), 'https://example.com/p.jpg');
    await userEvent.click(screen.getByTestId('manual-store-product-submit'));

    await waitFor(() => expect(onItemAdded).toHaveBeenCalled());

    const postCall = mockedApiRequest.mock.calls.find(
      (call) => call[0] === '/lists/42/items' && (call[1] as { method?: string })?.method === 'POST'
    );
    expect(postCall).toBeDefined();
    const body = (postCall![1] as { body?: { store_product?: { name?: string; image_url?: string | null; client_uuid?: string } } })?.body;
    expect(body?.store_product?.name).toBe('мляко данон 2%');
    expect(body?.store_product?.image_url).toBe('https://example.com/p.jpg');
    expect(body?.store_product?.client_uuid).toBeTruthy();
  });

  test('submitting the manual form with a blank name does nothing', async () => {
    mockedApiRequest.mockResolvedValueOnce({ user_products: [] });

    const onItemAdded = vi.fn();
    render(<AddSearchScreen selectedList={mockList} onItemAdded={onItemAdded} />);

    const input = await screen.findByLabelText('Търси термин');
    await userEvent.type(input, 'нещо');

    await userEvent.click(await screen.findByTestId('add-specific-item'));
    await userEvent.clear(screen.getByLabelText('Име на артикула'));

    expect(screen.getByTestId('manual-store-product-submit')).toBeDisabled();
    expect(onItemAdded).not.toHaveBeenCalled();
  });

  test('offline: manual store product still adds immediately and calls onItemAdded', async () => {
    mockedApiRequest
      .mockResolvedValueOnce({ user_products: [] })
      .mockRejectedValueOnce(new Error('Network error'));

    const onItemAdded = vi.fn();
    render(<AddSearchScreen selectedList={mockList} onItemAdded={onItemAdded} />);

    const input = await screen.findByLabelText('Търси термин');
    await userEvent.type(input, 'офлайн артикул');

    await userEvent.click(await screen.findByTestId('add-specific-item'));
    await userEvent.click(screen.getByTestId('manual-store-product-submit'));

    await waitFor(() => expect(onItemAdded).toHaveBeenCalled());
  });

  test('offline: apiRequest failure still optimistically adds and calls onItemAdded', async () => {
    await putUserProduct({
      client_uuid: 'up-offline',
      owner_type: 'user',
      owner_id: 7,
      term: 'кисело мляко',
      normalized_term: 'кисело мляко',
      created_at: '2026-06-17T09:00:00.000Z'
    });

    mockedApiRequest
      .mockResolvedValueOnce({ user_products: [
        { client_uuid: 'up-offline', owner_type: 'user', owner_id: 7, term: 'кисело мляко', normalized_term: 'кисело мляко', created_at: '2026-06-17T09:00:00.000Z' }
      ] })
      .mockRejectedValueOnce(new Error('Network error'));

    const onItemAdded = vi.fn();
    render(<AddSearchScreen selectedList={mockList} onItemAdded={onItemAdded} />);

    const input = await screen.findByLabelText('Търси термин');
    await userEvent.type(input, 'кисело мляко');

    const resultBtn = await screen.findByText('кисело мляко');
    await userEvent.click(resultBtn);

    await waitFor(() => expect(onItemAdded).toHaveBeenCalled());
  });
});
