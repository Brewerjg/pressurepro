import { describe, it, expect } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { profileOnboardedKey, markOnboarded } from "./onboarded-cache";

// The onboarding-completion race (found in the 1f live verification): the
// wizard used to invalidateQueries(["profile-onboarded"]) and navigate("/")
// immediately. With no active observer on /onboarding, invalidate only marks
// the query stale — the gate then mounts, reads the STALE cached
// { onboarded_at: null } on its first render, and bounces the user back to a
// blank wizard. These tests pin the fix: completion must synchronously PRIME
// the cache so the gate's first read is already onboarded.

describe("onboarded-cache", () => {
  it("primes the gate's query cache synchronously", () => {
    const qc = new QueryClient();
    // Simulate the stale post-signup state the gate cached before the wizard.
    qc.setQueryData(profileOnboardedKey("user-1"), { onboarded_at: null });

    const ts = "2026-07-10T12:00:00.000Z";
    markOnboarded(qc, "user-1", ts);

    expect(qc.getQueryData(profileOnboardedKey("user-1"))).toEqual({
      onboarded_at: ts,
    });
  });

  it("keys by user id (no cross-user bleed)", () => {
    const qc = new QueryClient();
    markOnboarded(qc, "user-1", "2026-07-10T12:00:00.000Z");
    expect(qc.getQueryData(profileOnboardedKey("user-2"))).toBeUndefined();
  });

  it("key shape matches the gate's ['profile-onboarded', id] contract", () => {
    expect(profileOnboardedKey("abc")).toEqual(["profile-onboarded", "abc"]);
  });
});
