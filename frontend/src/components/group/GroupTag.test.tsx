import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import GroupTag from './GroupTag';

describe('GroupTag', () => {
  it('renders the group name', () => {
    render(<GroupTag groupName="Engineering" role="member" />);
    expect(screen.getByText('Engineering')).toBeInTheDocument();
  });

  it('renders a gold crown for leader role', () => {
    const { container } = render(<GroupTag groupName="Engineering" role="leader" />);
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('renders a silver crown for manager role', () => {
    const { container } = render(<GroupTag groupName="Engineering" role="manager" />);
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('renders no crown for member role', () => {
    const { container } = render(<GroupTag groupName="Engineering" role="member" />);
    expect(container.querySelector('svg')).not.toBeInTheDocument();
  });

  it('calls onClick when clicked', () => {
    const onClick = vi.fn();
    render(<GroupTag groupName="Engineering" role="member" onClick={onClick} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('calls onClick on Enter keydown', () => {
    const onClick = vi.fn();
    render(<GroupTag groupName="Engineering" role="member" onClick={onClick} />);
    fireEvent.keyDown(screen.getByRole('button'), { key: 'Enter' });
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('does not render as a button when no onClick provided', () => {
    render(<GroupTag groupName="Engineering" role="member" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
