"use client";

import {
  createContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import {
  CONSENT_PENDING_KEY,
  TOS_VERSION,
  decideConsentAction,
} from "@/lib/consent";

// Type-only imports above don't add bundle weight. The runtime
// `@supabase/supabase-js` code is behind a dynamic import in
// `getSupabase()` below, so logged-out visitors never download the
// ~60KB gzipped Supabase chunk.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Profile {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  auth_provider: string | null;
  default_state: string | null;
  preferences: Record<string, unknown>;
  tos_accepted_at: string | null;
  tos_version: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuthContextValue {
  user: User | null;
  profile: Profile | null;
  isLoading: boolean;
  /** Generic OAuth sign-in — works with any Supabase-supported provider */
  signInWithOAuth: (provider: string) => Promise<void>;
  /** Passwordless email sign-in via magic link */
  signInWithMagicLink: (email: string) => Promise<{ error: string | null }>;
  /** Sign out and clear session */
  signOut: () => Promise<void>;
  /** Open the login modal from any component */
  openLoginModal: () => void;
  /** Close the login modal */
  closeLoginModal: () => void;
  /** Whether the login modal is currently open */
  loginModalOpen: boolean;
  /** True when a signed-in account must accept the Terms before continuing */
  needsConsent: boolean;
  /** Record Terms/Privacy + 13+ acceptance for the current user */
  acceptConsent: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export const AuthContext = createContext<AuthContextValue | null>(null);

// ---------------------------------------------------------------------------
// Cookie sniff
// ---------------------------------------------------------------------------

/**
 * Is there a Supabase session cookie in `document.cookie`? Used to skip the
 * Supabase client load entirely for logged-out visitors. Matches both the
 * modern `sb-<ref>-auth-token` and legacy `supabase.auth.token` naming
 * conventions, with optional `.0`/`.1`/… chunk suffixes that `@supabase/ssr`
 * adds when the serialized session grows past the ~4 KB cookie limit.
 */
const SESSION_COOKIE_RE = /^(sb-.+-auth-token|supabase\.auth\.token)(\.\d+)?$/;

function hasSupabaseSessionCookie(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie.split(";").some((c) => {
    const name = c.trim().split("=")[0];
    return SESSION_COOKIE_RE.test(name);
  });
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export default function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const [needsConsent, setNeedsConsent] = useState(false);

  // Cached Supabase client. Null until first call to `getSupabase()`.
  const supabaseRef = useRef<SupabaseClient | null>(null);
  // Inflight import promise; deduplicates concurrent getSupabase() calls.
  const loaderRef = useRef<Promise<SupabaseClient> | null>(null);
  // Subscription handle so we can unsubscribe on unmount.
  const subscriptionRef = useRef<{ unsubscribe: () => void } | null>(null);

  // Write Terms/Privacy + 13+ acceptance to the user's own profiles row
  // (allowed by the "Users update own profile" RLS policy). Patches local
  // state on success so the UI reflects acceptance without a refetch.
  const writeConsent = useCallback(
    async (
      supabase: SupabaseClient,
      userId: string,
      version: string
    ): Promise<boolean> => {
      const acceptedAt = new Date().toISOString();
      const { error } = await supabase
        .from("profiles")
        .update({ tos_accepted_at: acceptedAt, tos_version: version })
        .eq("id", userId);
      if (error) return false;
      setProfile((p) =>
        p ? { ...p, tos_accepted_at: acceptedAt, tos_version: version } : p
      );
      return true;
    },
    []
  );

  // After auth, reconcile consent: record a fresh signup's pending acceptance,
  // or flag that an existing account must accept now. See lib/consent.ts.
  const reconcileConsent = useCallback(
    async (supabase: SupabaseClient, userId: string, profileData: Profile) => {
      const pending =
        typeof window !== "undefined"
          ? localStorage.getItem(CONSENT_PENDING_KEY)
          : null;
      const action = decideConsentAction(profileData.tos_accepted_at, pending);
      if (action === "none") {
        if (pending) localStorage.removeItem(CONSENT_PENDING_KEY);
        setNeedsConsent(false);
        return;
      }
      if (action === "record") {
        const ok = await writeConsent(supabase, userId, pending as string);
        if (ok) {
          localStorage.removeItem(CONSENT_PENDING_KEY);
          setNeedsConsent(false);
        } else {
          // write failed — fall back to prompting so consent still lands
          setNeedsConsent(true);
        }
        return;
      }
      setNeedsConsent(true); // "prompt"
    },
    [writeConsent]
  );

  // Fetch profile from profiles table, then reconcile consent. Uses whatever
  // Supabase client is already loaded — called only after auth state is known.
  const fetchProfile = useCallback(
    async (userId: string) => {
      const supabase = supabaseRef.current;
      if (!supabase) return;
      try {
        const { data } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", userId)
          .single();

        if (data) {
          setProfile(data as Profile);
          await reconcileConsent(supabase, userId, data as Profile);
        }
      } catch {
        // Profile fetch failed — user stays authenticated without profile data
      }
    },
    [reconcileConsent]
  );

  /**
   * Dynamic-import + instantiate the Supabase client on first call. Wires
   * up the `onAuthStateChange` subscription exactly once per mount so that
   * sign-in / token-refresh / cross-tab sign-out all flow through to React
   * state regardless of which code path first triggered the load.
   */
  const getSupabase = useCallback(async (): Promise<SupabaseClient> => {
    if (supabaseRef.current) return supabaseRef.current;
    if (!loaderRef.current) {
      loaderRef.current = import("@/lib/supabase/client").then(
        ({ createClient }) => {
          const client = createClient();
          supabaseRef.current = client;

          // Subscribe once per client instantiation.
          const { data } = client.auth.onAuthStateChange(
            async (_event, session) => {
              const newUser = session?.user ?? null;
              setUser(newUser);
              if (newUser) {
                await fetchProfile(newUser.id);
                setLoginModalOpen(false);
              } else {
                setProfile(null);
              }
              setIsLoading(false);
            }
          );
          subscriptionRef.current = data.subscription;

          return client;
        }
      );
    }
    return loaderRef.current;
  }, [fetchProfile]);

  // Initialize auth state on mount.
  useEffect(() => {
    const initAuth = async () => {
      // Fast path for logged-out visitors: no Supabase cookie → skip the
      // client load entirely. This keeps the ~60KB gzip chunk off the
      // initial bundle for the vast majority of first-touch traffic.
      // sign-in buttons will still load it on click via getSupabase().
      if (!hasSupabaseSessionCookie()) {
        setIsLoading(false);
        return;
      }

      try {
        const supabase = await getSupabase();

        // Resolve initial session with a 5s safety timeout so the loading
        // spinner never hangs if the network is unreachable.
        const userPromise = supabase.auth.getUser();
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Auth timeout")), 5000)
        );

        const {
          data: { user: currentUser },
        } = await Promise.race([userPromise, timeoutPromise]);

        setUser(currentUser);
        if (currentUser) {
          await fetchProfile(currentUser.id);
        }
      } catch {
        // No session, timeout, or error — user stays null.
      } finally {
        setIsLoading(false);
      }
    };

    initAuth();

    return () => {
      subscriptionRef.current?.unsubscribe();
      subscriptionRef.current = null;
    };
  }, [fetchProfile, getSupabase]);

  // ---------------------------------------------------------------------------
  // Auth actions — each triggers the dynamic Supabase load on first use
  // ---------------------------------------------------------------------------

  const signInWithOAuth = useCallback(
    async (provider: string) => {
      const siteUrl =
        typeof window !== "undefined"
          ? window.location.origin
          : process.env.NEXT_PUBLIC_SITE_URL || "https://communitycollegepath.com";

      // Redirect back to the current page after auth
      const redirectTo = `${siteUrl}/auth/callback?next=${encodeURIComponent(
        typeof window !== "undefined" ? window.location.pathname : "/"
      )}`;

      const supabase = await getSupabase();
      await supabase.auth.signInWithOAuth({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        provider: provider as any,
        options: { redirectTo },
      });
    },
    [getSupabase]
  );

  const signInWithMagicLink = useCallback(
    async (email: string): Promise<{ error: string | null }> => {
      const siteUrl =
        typeof window !== "undefined"
          ? window.location.origin
          : process.env.NEXT_PUBLIC_SITE_URL ||
            "https://communitycollegepath.com";

      const redirectTo = `${siteUrl}/auth/callback?next=${encodeURIComponent(
        typeof window !== "undefined" ? window.location.pathname : "/"
      )}`;

      const supabase = await getSupabase();
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: redirectTo },
      });

      return { error: error?.message ?? null };
    },
    [getSupabase]
  );

  const signOut = useCallback(async () => {
    // If the client never loaded (logged-out visitor who never clicked
    // sign-in), there's nothing to sign out of — just clear local state.
    if (supabaseRef.current) {
      await supabaseRef.current.auth.signOut();
    }
    setUser(null);
    setProfile(null);
    setNeedsConsent(false);
  }, []);

  // Accept the current Terms/Privacy + 13+ attestation (used by the
  // existing-account ConsentPrompt; signup records consent automatically).
  const acceptConsent = useCallback(async () => {
    const supabase = supabaseRef.current;
    const uid = user?.id;
    if (!supabase || !uid) return;
    const ok = await writeConsent(supabase, uid, TOS_VERSION);
    if (ok) {
      if (typeof window !== "undefined") {
        localStorage.removeItem(CONSENT_PENDING_KEY);
      }
      setNeedsConsent(false);
    }
  }, [user, writeConsent]);

  const openLoginModal = useCallback(() => setLoginModalOpen(true), []);
  const closeLoginModal = useCallback(() => setLoginModalOpen(false), []);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        isLoading,
        signInWithOAuth,
        signInWithMagicLink,
        signOut,
        openLoginModal,
        closeLoginModal,
        loginModalOpen,
        needsConsent,
        acceptConsent,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
