import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import UserPage from './UserPage';
import { makeUser } from '../../test/factories';

function renderPage(user = makeUser()) {
  return render(
    <MemoryRouter>
      <UserPage user={user} />
    </MemoryRouter>,
  );
}

describe('UserPage', () => {
  it('renders display name and username', () => {
    renderPage(makeUser({ name: 'Alice Chen', username: 'alice.chen' }));
    expect(screen.getByText('Alice Chen')).toBeInTheDocument();
    expect(screen.getByText('alice.chen')).toBeInTheDocument();
  });

  it('shows Active badge for active users', () => {
    renderPage(makeUser({ is_active: true }));
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('shows Suspended badge for inactive users', () => {
    renderPage(makeUser({ is_active: false }));
    expect(screen.getByText('Suspended')).toBeInTheDocument();
  });

  it('renders telegram login as a t.me link', () => {
    renderPage(makeUser({ logins: { telegram: '@alice', google: undefined } }));
    const link = screen.getByRole('link', { name: '@alice' });
    expect(link).toHaveAttribute('href', 'https://t.me/alice');
  });

  it('renders google login as plain text', () => {
    renderPage(makeUser({ logins: { google: 'alice@example.com', telegram: undefined } }));
    expect(screen.getByText('alice@example.com')).toBeInTheDocument();
  });

  it('renders nothing when both logins are absent', () => {
    renderPage(makeUser({ logins: {} }));
    expect(screen.queryByText('Telegram')).not.toBeInTheDocument();
    expect(screen.queryByText('Google')).not.toBeInTheDocument();
  });

  it('shows group tags with correct role styling', () => {
    const user = makeUser({
      groups: {
        leader: [{ name: 'Engineering' }],
        manager: [{ name: 'Design' }],
        member: [{ name: 'All Staff' }],
      },
    });
    renderPage(user);
    expect(screen.getByText('Engineering')).toBeInTheDocument();
    expect(screen.getByText('Design')).toBeInTheDocument();
    expect(screen.getByText('All Staff')).toBeInTheDocument();
  });

  it('shows groups sorted alphabetically', () => {
    const user = makeUser({
      groups: {
        leader: [{ name: 'Zebra' }],
        manager: [],
        member: [{ name: 'Alpha' }],
      },
    });
    renderPage(user);
    const tags = screen.getAllByRole('button');
    const names = tags.map((t) => t.textContent?.replace(/[^\w\s]/g, '').trim());
    expect(names.indexOf('Alpha')).toBeLessThan(names.indexOf('Zebra'));
  });

  it('shows empty state when user has no groups', () => {
    renderPage(makeUser({ groups: { leader: [], manager: [], member: [] } }));
    expect(screen.getByText(/no group memberships/i)).toBeInTheDocument();
  });
});
