import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { HomeScreen } from '../components/HomeScreen';
import { apiRequest } from '../api/client';
import { clearDatabase, putList, putListItem } from '../storage/db';
import { useAuthStore } from '../store/auth';

// HomeScreen's hard sync on mount calls fetchLists()/fetchListWithItems() —
// stub them to reject (an "offline boot") so it falls into the catch path
// that reads local-first data untouched, instead of clearSyncedData()
// wiping the IndexedDB rows this test seeds directly below.
vi.mock('../api/client', () => ({
  apiRequest: vi.fn(),
  fetchLists: vi.fn().mockRejectedValue(new Error('offline')),
  fetchListWithItems: vi.fn().mockRejectedValue(new Error('offline')),
  logout: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    code?: string;
    constructor(status: number, message: string, code?: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  }
}));

const mockedApiRequest = vi.mocked(apiRequest);

beforeEach(async () => {
  mockedApiRequest.mockReset();
  await clearDatabase();
  useAuthStore.getState().setSession({
    accessToken: 'token',
    expiresIn: 900,
    user: { id: 7, displayName: 'Ива', familyIds: [] }
  });

  await putList({
    client_uuid: 'list-1',
    id: '42',
    name: 'Тест',
    owner_type: 'user',
    owner_id: 7,
    updated_at: '2026-06-20T09:00:00.000Z'
  });

  // Deliberately seed a list item that references a UserProduct by
  // client_uuid WITHOUT a matching row in the local user_products store —
  // reproduces a list item surviving a hard sync (or any other path) ahead
  // of its own UserProduct's local cache entry.
  await putListItem({
    client_uuid: 'item-1',
    id: '900',
    list_client_uuid: 'list-1',
    list_id: '42',
    user_product_client_uuid: 'up-orphan',
    user_product_id: '55',
    quantity: 2,
    unit: 'бр.',
    is_checked: false,
    created_at: '2026-06-20T09:00:00.000Z',
    updated_at: '2026-06-20T09:00:00.000Z'
  });
});

describe('opening an item detail screen when the local UserProduct cache missed it', () => {
  test('falls back to the server and still opens, instead of the tile silently doing nothing', async () => {
    mockedApiRequest.mockResolvedValue({
      user_products: [
        {
          client_uuid: 'up-orphan',
          id: '55',
          owner_type: 'user',
          owner_id: 7,
          term: 'мляко',
          normalized_term: 'мляко',
          created_at: '2026-06-20T09:00:00.000Z',
          is_favorite: false
        }
      ]
    });

    render(<HomeScreen />);

    await userEvent.click(await screen.findByRole('button', { name: 'Отвори Тест' }));
    const trigger = await screen.findByTestId('item-detail-trigger-item-1');
    await userEvent.click(trigger);

    expect(await screen.findByTestId('user-product-detail')).toBeInTheDocument();
    expect(screen.getByLabelText('Термин')).toHaveValue('мляко');
  });

  test('shows an inline error instead of silently doing nothing when the server has no match either', async () => {
    mockedApiRequest.mockResolvedValue({ user_products: [] });

    render(<HomeScreen />);

    await userEvent.click(await screen.findByRole('button', { name: 'Отвори Тест' }));
    const trigger = await screen.findByTestId('item-detail-trigger-item-1');
    await userEvent.click(trigger);

    expect(await screen.findByRole('alert')).toHaveTextContent('Този артикул не може да се отвори в момента.');
    expect(screen.queryByTestId('user-product-detail')).not.toBeInTheDocument();
  });
});

describe('opening a store-product detail screen when the local cache missed it', () => {
  beforeEach(async () => {
    await putListItem({
      client_uuid: 'item-sp-1',
      id: '901',
      list_client_uuid: 'list-1',
      list_id: '42',
      store_product_client_uuid: 'sp-orphan',
      store_product_id: '77',
      quantity: 1,
      unit: 'бр.',
      is_checked: false,
      created_at: '2026-06-21T09:00:00.000Z',
      updated_at: '2026-06-21T09:00:00.000Z'
    });
  });

  test('falls back to GET /store-products/{id} and still opens, instead of the tile silently doing nothing', async () => {
    mockedApiRequest.mockResolvedValue({
      store_product: {
        id: '77',
        client_uuid: 'sp-orphan',
        source: 'user',
        created_by_user_id: '7',
        name: 'Мляко Данон 2% 1л',
        image_url: null,
        barcode: null,
        created_at: '2026-06-21T09:00:00.000Z'
      }
    });

    render(<HomeScreen />);

    await userEvent.click(await screen.findByRole('button', { name: 'Отвори Тест' }));
    const trigger = await screen.findByTestId('item-detail-trigger-item-sp-1');
    await userEvent.click(trigger);

    expect(await screen.findByTestId('store-product-detail')).toBeInTheDocument();
    expect(screen.getByLabelText('Име')).toHaveValue('Мляко Данон 2% 1л');
  });

  test('shows an inline error instead of silently doing nothing when the server has no match either', async () => {
    mockedApiRequest.mockRejectedValue(new Error('not found'));

    render(<HomeScreen />);

    await userEvent.click(await screen.findByRole('button', { name: 'Отвори Тест' }));
    const trigger = await screen.findByTestId('item-detail-trigger-item-sp-1');
    await userEvent.click(trigger);

    expect(await screen.findByRole('alert')).toHaveTextContent('Този артикул не може да се отвори в момента.');
    expect(screen.queryByTestId('store-product-detail')).not.toBeInTheDocument();
  });
});

describe('list row unit display', () => {
  test('shows бр. instead of the internal English default "piece"', async () => {
    mockedApiRequest.mockResolvedValue({ user_products: [] });
    await putListItem({
      client_uuid: 'item-2',
      id: '901',
      list_client_uuid: 'list-1',
      list_id: '42',
      user_product_client_uuid: 'up-2',
      user_product_id: '56',
      quantity: 3,
      unit: 'piece',
      is_checked: false,
      created_at: '2026-06-20T09:00:01.000Z',
      updated_at: '2026-06-20T09:00:01.000Z'
    });

    render(<HomeScreen />);

    await userEvent.click(await screen.findByRole('button', { name: 'Отвори Тест' }));

    expect(await screen.findByText('3 бр.')).toBeInTheDocument();
    expect(screen.queryByText(/piece/)).not.toBeInTheDocument();
  });
});
