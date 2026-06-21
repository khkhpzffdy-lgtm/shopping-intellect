import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { CategoryDetailScreen } from '../components/CategoryDetailScreen';
import { apiRequest } from '../api/client';
import { clearDatabase } from '../storage/db';
import { useAuthStore } from '../store/auth';

vi.mock('../api/client', () => ({
  apiRequest: vi.fn(),
  fetchLists: vi.fn().mockResolvedValue({ lists: [] }),
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

const baseResponse = {
  category: { id: '1', slug: 'dairy', name: 'Млечни продукти', parent_id: null },
  children: [{ id: '2', slug: 'milk', name: 'Мляко', parent_id: '1' }],
  user_products: [
    { client_uuid: 'up-1', id: '10', owner_type: 'user', owner_id: 7, term: 'мляко', normalized_term: 'мляко', created_at: '2026-06-01T10:00:00.000Z' }
  ],
  store_products: [
    { client_uuid: 'sp-1', id: '20', source: 'user', created_by_user_id: 7, name: 'Мляко Данон 2% 1л', created_at: '2026-06-01T10:00:00.000Z' }
  ]
};

beforeEach(async () => {
  mockedApiRequest.mockReset();
  await clearDatabase();
  useAuthStore.getState().setSession({
    accessToken: 'header.eyJ1c2VyX2lkIjo3fQ.signature',
    expiresIn: 900,
    user: { id: 7, displayName: 'Ива', familyIds: [] }
  });
  mockedApiRequest.mockResolvedValue(baseResponse);
});

describe('CategoryDetailScreen', () => {
  test('renders the bucket name, children, and attached records', async () => {
    render(<CategoryDetailScreen categoryId="1" onClose={() => {}} />);

    expect(await screen.findByText('Мляко Данон 2% 1л')).toBeInTheDocument();
    expect(screen.getByText('мляко')).toBeInTheDocument();
    expect(screen.getByTestId('category-child-2')).toBeInTheDocument();
    expect(mockedApiRequest).toHaveBeenCalledWith('/categories/1/products', { authenticated: true });
  });

  test('tapping a child category drills down into it', async () => {
    mockedApiRequest.mockImplementation(async (path: string) => {
      if (path === '/categories/1/products') return baseResponse;
      if (path === '/categories/2/products') {
        return {
          category: { id: '2', slug: 'milk', name: 'Мляко', parent_id: '1' },
          children: [],
          user_products: [],
          store_products: []
        };
      }
      throw new Error(`unexpected path ${path}`);
    });

    render(<CategoryDetailScreen categoryId="1" onClose={() => {}} />);

    const childRow = await screen.findByTestId('category-child-2');
    await userEvent.click(childRow);

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith('/categories/2/products', { authenticated: true });
    });
  });

  test('archive succeeds for an owned row not on any list', async () => {
    mockedApiRequest.mockImplementation(async (path: string, options?: { method?: string }) => {
      if (path === '/categories/1/products') return baseResponse;
      if (path === '/user-products/10' && options?.method === 'PATCH') return { user_product: { ...baseResponse.user_products[0], is_archived: true } };
      throw new Error(`unexpected ${path}`);
    });

    render(<CategoryDetailScreen categoryId="1" onClose={() => {}} />);

    await screen.findByText('мляко');
    const archiveButtons = screen.getAllByText('Архивирай');
    await userEvent.click(archiveButtons[0]);

    await waitFor(() => {
      expect(screen.queryByText('мляко')).not.toBeInTheDocument();
    });
  });

  test('archive blocked while on an active list shows a clear message, not a raw error', async () => {
    const { ApiError } = await import('../api/client');

    mockedApiRequest.mockImplementation(async (path: string, options?: { method?: string }) => {
      if (path === '/categories/1/products') return baseResponse;
      if (path === '/user-products/10' && options?.method === 'PATCH') {
        throw new ApiError(409, 'In use', 'in_use');
      }
      throw new Error(`unexpected ${path}`);
    });

    render(<CategoryDetailScreen categoryId="1" onClose={() => {}} />);

    await screen.findByText('мляко');
    const archiveButtons = screen.getAllByText('Архивирай');
    await userEvent.click(archiveButtons[0]);

    expect(await screen.findByRole('alert')).toHaveTextContent('Премахни го от списъка');
    expect(screen.getByText('мляко')).toBeInTheDocument();
  });

  test('creating a new term attaches it to this bucket immediately', async () => {
    mockedApiRequest.mockImplementation(async (path: string, options?: { method?: string }) => {
      if (path === '/categories/1/products') return baseResponse;
      if (path === '/user-products' && options?.method === 'POST') {
        return { user_product: { client_uuid: 'up-2', id: '11', owner_type: 'user', owner_id: 7, term: 'хляб', normalized_term: 'хляб', created_at: '2026-06-01T10:00:00.000Z' } };
      }
      throw new Error(`unexpected ${path}`);
    });

    render(<CategoryDetailScreen categoryId="1" onClose={() => {}} />);

    await screen.findByText('мляко');
    await userEvent.click(screen.getByText('Нов термин в този бъкет'));
    await userEvent.type(screen.getByLabelText('Нов термин'), 'хляб');
    await userEvent.click(screen.getByRole('button', { name: 'Добави' }));

    expect(await screen.findByText('хляб')).toBeInTheDocument();
  });

  test('a system-owned term has no archive button', async () => {
    mockedApiRequest.mockResolvedValue({
      ...baseResponse,
      user_products: [
        { client_uuid: 'up-1', id: '10', owner_type: 'system', owner_id: 0, term: 'домати', normalized_term: 'домати', created_at: '2026-06-01T10:00:00.000Z', is_global_default: true }
      ],
      store_products: []
    });

    render(<CategoryDetailScreen categoryId="1" onClose={() => {}} />);

    await screen.findByText('домати');
    expect(screen.queryByText('Архивирай')).not.toBeInTheDocument();
  });
});
