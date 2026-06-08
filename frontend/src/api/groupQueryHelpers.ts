import type { QueryClient } from '@tanstack/react-query';

export function invalidateGroup(queryClient: QueryClient, groupName: string): void {
  void queryClient.invalidateQueries({ queryKey: ['group', groupName] });
  void queryClient.invalidateQueries({ queryKey: ['groups'] });
}
