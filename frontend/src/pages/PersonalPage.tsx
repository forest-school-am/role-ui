import React from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getMe, getUser } from '../api/users';
import UserCard from '../components/UserCard';
import PageLoadingSkeleton from '../components/ui/PageLoadingSkeleton';
import PageErrorCard from '../components/ui/PageErrorCard';

const PersonalPage: React.FC = () => {
  // Present on /users/:username, absent on /me
  const { username } = useParams<{ username?: string }>();

  const { data: user, isLoading, isError, error } = useQuery({
    queryKey: username ? ['user', username] : ['me'],
    queryFn: username ? () => getUser(username) : getMe,
  });

  if (isLoading) {
    return <PageLoadingSkeleton />;
  }

  if (isError) {
    const message =
      error instanceof Error ? error.message : 'Failed to load user profile.';
    const isAuthError = message.includes('502') || message.includes('401');
    return (
      <PageErrorCard message={message}>
        {isAuthError && !username && (
          <button
            className="rounded bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-700"
            onClick={() => {
              sessionStorage.clear();
              window.location.href = '/';
            }}
          >
            Sign out and try again
          </button>
        )}
      </PageErrorCard>
    );
  }

  if (!user) return null;

  return (
    <div className="flex justify-center p-8">
      <UserCard user={user} />
    </div>
  );
};

export default PersonalPage;
