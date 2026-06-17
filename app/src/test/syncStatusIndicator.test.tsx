import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { SyncStatusIndicator } from '../components/SyncStatusIndicator';

test('renders nothing when nothing is pending or failed', () => {
  const { container } = render(<SyncStatusIndicator pending={0} failed={0} />);
  expect(container).toBeEmptyDOMElement();
});

test('renders the pending icon when a mutation is queued', () => {
  render(<SyncStatusIndicator pending={1} failed={0} />);
  expect(screen.getByLabelText('Синхронизира се')).toBeInTheDocument();
});

test('renders the failed icon when a mutation has failed', () => {
  render(<SyncStatusIndicator pending={0} failed={1} />);
  expect(screen.getByLabelText('Грешка при синхронизация')).toBeInTheDocument();
});

test('failed wins over pending when both are non-zero', () => {
  render(<SyncStatusIndicator pending={2} failed={1} />);
  expect(screen.getByLabelText('Грешка при синхронизация')).toBeInTheDocument();
  expect(screen.queryByLabelText('Синхронизира се')).not.toBeInTheDocument();
});
