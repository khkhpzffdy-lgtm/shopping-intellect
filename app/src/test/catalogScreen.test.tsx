import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { CatalogScreen } from '../components/CatalogScreen';
import { apiRequest } from '../api/client';

vi.mock('../api/client', () => ({
  apiRequest: vi.fn()
}));

const mockedApiRequest = vi.mocked(apiRequest);

beforeEach(() => {
  mockedApiRequest.mockReset();
});

describe('CatalogScreen', () => {
  test('renders category names from /categories', async () => {
    mockedApiRequest.mockResolvedValue({
      categories: [
        { id: '1', slug: 'milk', name: 'Мляко' },
        { id: '2', slug: 'bread', name: 'Хляб' }
      ]
    });

    render(<CatalogScreen />);

    expect(await screen.findByText('Мляко')).toBeInTheDocument();
    expect(screen.getByText('Хляб')).toBeInTheDocument();
    expect(mockedApiRequest).toHaveBeenCalledWith('/categories');
  });

  test('shows empty state when there are no categories', async () => {
    mockedApiRequest.mockResolvedValue({ categories: [] });

    render(<CatalogScreen />);

    expect(await screen.findByText('Все още няма категории.')).toBeInTheDocument();
  });

  test('shows withheld state on offline/error, does not crash', async () => {
    mockedApiRequest.mockRejectedValue(new Error('Network error'));

    render(<CatalogScreen />);

    expect(await screen.findByText('Каталогът не може да се зареди в момента.')).toBeInTheDocument();
  });

  test('does not fetch while inactive', () => {
    render(<CatalogScreen isActive={false} />);
    expect(mockedApiRequest).not.toHaveBeenCalled();
  });
});
