import React from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getMe, getUser } from '../api/users';
import UserCard from '../components/UserCard';

const PersonalPage: React.FC = () => {
  // Present on /users/:userUuid, absent on /me
  const { userUuid } = useParams<{ userUuid?: string }>();

  const { data: user, isLoading, isError, error } = useQuery({
    queryKey: userUuid ? ['user', userUuid] : ['me'],
    queryFn: userUuid ? () => getUser(userUuid) : () => getMe(),
  });

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="space-y-3 w-full max-w-xl mx-auto p-8">
          <div className="h-8 rounded bg-gray-200 animate-pulse w-1/2" />
          <div className="h-4 rounded bg-gray-200 animate-pulse w-3/4" />
          <div className="h-4 rounded bg-gray-200 animate-pulse w-2/3" />
        </div>
      </div>
    );
  }

  if (isError) {
    const message =
      error instanceof Error ? error.message : 'Failed to load user profile.';
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <div className="rounded-lg border border-red-300 bg-red-50 p-6 text-red-800 max-w-md w-full">
          <h2 className="text-lg font-semibold mb-1">Error</h2>
          <p className="text-sm">{message}</p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="flex min-h-screen items-start justify-center p-8">
      <UserCard user={user} />
    </div>
  );
};

export default PersonalPage;
