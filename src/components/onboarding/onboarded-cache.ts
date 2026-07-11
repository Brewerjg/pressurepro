import type { QueryClient } from "@tanstack/react-query";

// Single source of truth for the onboarding gate's cache entry, shared by
// RequireOnboarded (reader) and the Onboarding wizard (writer).
//
// Why a synchronous cache WRITE and not invalidateQueries: while the wizard
// is up, /onboarding is not wrapped in RequireOnboarded, so the gate's query
// has no active observer — invalidate only marks it stale. navigate("/") then
// mounts the gate, which decides on the stale cached { onboarded_at: null }
// during its first render and bounces the user back to a blank wizard (the
// refetch lands too late). Priming the cache before navigating makes the
// gate's first read already-onboarded, deterministically.

export const profileOnboardedKey = (userId: string | undefined) =>
  ["profile-onboarded", userId] as const;

export function markOnboarded(
  queryClient: QueryClient,
  userId: string | undefined,
  onboardedAt: string,
): void {
  queryClient.setQueryData(profileOnboardedKey(userId), {
    onboarded_at: onboardedAt,
  });
}
