import type { QueryClient } from '@tanstack/react-query';

/**
 * Invalidates both the specific group detail cache and the full groups list.
 */
export function invalidateGroup(queryClient: QueryClient, groupPk: string): void {
  void queryClient.invalidateQueries({ queryKey: ['group', groupPk] });
  void queryClient.invalidateQueries({ queryKey: ['groups'] });
}
