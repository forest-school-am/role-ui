import type { QueryClient } from '@tanstack/react-query';

export function invalidateGroup(queryClient: QueryClient, groupName: string): void {
  void queryClient.refetchQueries({ queryKey: ['group', groupName] });
  void queryClient.refetchQueries({ queryKey: ['groups'] });
}
