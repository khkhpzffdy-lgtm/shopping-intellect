import { render, screen } from '@testing-library/react';
import { beforeEach, expect, test } from 'vitest';
import { OfflineBanner } from '../components/OfflineBanner';
import { useConnectivityStore } from '../store/connectivity';

beforeEach(() => {
  useConnectivityStore.getState().setOnline(true);
});

test('renders nothing while online', () => {
  const { container } = render(<OfflineBanner />);
  expect(container).toBeEmptyDOMElement();
});

test('renders the offline strip with the exact Bulgarian copy while offline', () => {
  useConnectivityStore.getState().setOnline(false);
  render(<OfflineBanner />);
  expect(
    screen.getByText('Офлайн · отметките се запазват и ще се синхронизират')
  ).toBeInTheDocument();
});
