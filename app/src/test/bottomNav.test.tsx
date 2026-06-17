import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { BottomNav } from '../components/BottomNav';

describe('BottomNav', () => {
  test('renders both tabs', () => {
    render(<BottomNav activeTab="lists" onTabChange={() => {}} />);
    expect(screen.getByText('Списъци')).toBeInTheDocument();
    expect(screen.getByText('Добавяне')).toBeInTheDocument();
  });

  test('marks active tab with aria-current', () => {
    const { rerender } = render(<BottomNav activeTab="lists" onTabChange={() => {}} />);
    expect(screen.getByText('Списъци').closest('button')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('Добавяне').closest('button')).not.toHaveAttribute('aria-current');

    rerender(<BottomNav activeTab="add" onTabChange={() => {}} />);
    expect(screen.getByText('Добавяне').closest('button')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('Списъци').closest('button')).not.toHaveAttribute('aria-current');
  });

  test('calls onTabChange with correct tab when clicked', async () => {
    const onTabChange = vi.fn();
    render(<BottomNav activeTab="lists" onTabChange={onTabChange} />);

    await userEvent.click(screen.getByText('Добавяне').closest('button')!);
    expect(onTabChange).toHaveBeenCalledWith('add');

    await userEvent.click(screen.getByText('Списъци').closest('button')!);
    expect(onTabChange).toHaveBeenCalledWith('lists');
  });
});
