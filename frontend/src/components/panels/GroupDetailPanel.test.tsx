import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AddMemberModal, ResignLeaderModal } from './GroupDetailPanel';
import * as groupsApi from '../../api/groups';
import * as usersApi from '../../api/users';

vi.mock('../../api/groups');
vi.mock('../../api/users');

function withQuery(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('AddMemberModal', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(usersApi.searchUsers).mockResolvedValue([
      { username: 'bob', name: 'Bob Smith' },
      { username: 'carol', name: 'Carol Jones' },
    ]);
    vi.mocked(groupsApi.addMember).mockResolvedValue({ ok: true });
  });

  it('shows an error when submitted without selecting a user', async () => {
    withQuery(<AddMemberModal groupName="Engineering" onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: /^Add$/ }));
    expect(screen.getByText(/please search for and select a user/i)).toBeInTheDocument();
    expect(groupsApi.addMember).not.toHaveBeenCalled();
  });

  it('searches as the user types and shows results', async () => {
    withQuery(<AddMemberModal groupName="Engineering" onClose={onClose} />);
    await userEvent.type(screen.getByPlaceholderText(/e\.g\. alice/i), 'bob');
    await waitFor(() => expect(usersApi.searchUsers).toHaveBeenCalled());
    expect(await screen.findByText('Bob Smith (bob)')).toBeInTheDocument();
  });

  it('calls addMember with username after selecting a user', async () => {
    withQuery(<AddMemberModal groupName="Engineering" onClose={onClose} />);
    await userEvent.type(screen.getByPlaceholderText(/e\.g\. alice/i), 'bob');
    await waitFor(() => expect(usersApi.searchUsers).toHaveBeenCalled());
    await userEvent.click(await screen.findByText('Bob Smith (bob)'));
    await userEvent.click(screen.getByRole('button', { name: /^Add$/ }));
    await waitFor(() =>
      expect(groupsApi.addMember).toHaveBeenCalledWith('Engineering', 'bob'),
    );
  });

  it('calls onClose after successful submission', async () => {
    withQuery(<AddMemberModal groupName="Engineering" onClose={onClose} />);
    await userEvent.type(screen.getByPlaceholderText(/e\.g\. alice/i), 'bob');
    await waitFor(() => expect(usersApi.searchUsers).toHaveBeenCalled());
    await userEvent.click(await screen.findByText('Bob Smith (bob)'));
    await userEvent.click(screen.getByRole('button', { name: /^Add$/ }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('calls onClose when Cancel is clicked', async () => {
    withQuery(<AddMemberModal groupName="Engineering" onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('ResignLeaderModal', () => {
  const onClose = vi.fn();
  const managers = [
    { username: 'bob', name: 'Bob Smith' },
    { username: 'carol', name: 'Carol Jones' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(groupsApi.resignLeader).mockResolvedValue({ ok: true });
  });

  it('disables submit when no successor is selected', () => {
    withQuery(<ResignLeaderModal groupName="Engineering" members={managers} onClose={onClose} />);
    expect(screen.getByRole('button', { name: /resign/i })).toBeDisabled();
  });

  it('disables submit until the group name is typed', async () => {
    withQuery(<ResignLeaderModal groupName="Engineering" members={managers} onClose={onClose} />);
    await userEvent.selectOptions(screen.getByRole('combobox'), 'bob');
    expect(screen.getByRole('button', { name: /resign/i })).toBeDisabled();
  });

  it('enables submit when successor selected and group name confirmed', async () => {
    withQuery(<ResignLeaderModal groupName="Engineering" members={managers} onClose={onClose} />);
    await userEvent.selectOptions(screen.getByRole('combobox'), 'bob');
    await userEvent.type(screen.getByPlaceholderText(/type the group name/i), 'Engineering');
    expect(screen.getByRole('button', { name: /resign/i })).not.toBeDisabled();
  });

  it('calls resignLeader with username (not pk)', async () => {
    withQuery(<ResignLeaderModal groupName="Engineering" members={managers} onClose={onClose} />);
    await userEvent.selectOptions(screen.getByRole('combobox'), 'bob');
    await userEvent.type(screen.getByPlaceholderText(/type the group name/i), 'Engineering');
    await userEvent.click(screen.getByRole('button', { name: /resign/i }));
    await waitFor(() =>
      expect(groupsApi.resignLeader).toHaveBeenCalledWith('Engineering', 'bob'),
    );
  });

  it('shows empty state message when no managers or members', () => {
    withQuery(<ResignLeaderModal groupName="Engineering" members={[]} onClose={onClose} />);
    expect(screen.getByText(/no eligible members/i)).toBeInTheDocument();
  });
});
