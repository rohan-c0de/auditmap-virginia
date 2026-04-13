"use client";

import {
  createContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";

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
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export const AuthContext = createContext<AuthContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export default function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const supabaseRef = useRef(createClient());

  // Fetch profile from profiles table
  const fetchProfile = useCallback(async (userId: string) => {
    try {
      const { data } = await supabaseRef.current
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .single();

      if (data) {
        setProfile(data as Profile);
      }
    } catch {
      // Profile fetch failed — user stays authenticated without profile data
    }
  }, []);

  // Initialize auth state
  useEffect(() => {
    const supabase = supabaseRef.current;

    // Get the initial session with a timeout so loading never hangs
    const initAuth = async () => {
      try {
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
        // No session, timeout, or error — user stays null
      } finally {
        setIsLoading(false);
      }
    };

    initAuth();

    // Listen for auth state changes (login, logout, token refresh)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      const newUser = session?.user ?? null;
      setUser(newUser);

      if (newUser) {
        await fetchProfile(newUser.id);
        // Close login modal on successful sign-in
        setLoginModalOpen(false);
      } else {
        setProfile(null);
      }

      setIsLoading(false);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [fetchProfile]);

  // ---------------------------------------------------------------------------
  // Auth actions
  // ---------------------------------------------------------------------------

  const signInWithOAuth = useCallback(async (provider: string) => {
    const siteUrl =
      typeof window !== "undefined"
        ? window.location.origin
        : process.env.NEXT_PUBLIC_SITE_URL || "https://communitycollegepath.com";

    // Redirect back to the current page after auth
    const redirectTo = `${siteUrl}/auth/callback?next=${encodeURIComponent(
      typeof window !== "undefined" ? window.location.pathname : "/"
    )}`;

    await supabaseRef.current.auth.signInWithOAuth({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      provider: provider as any,
      options: {
        redirectTo,
      },
    });
  }, []);

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

      const { error } = await supabaseRef.current.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: redirectTo,
        },
      });

      return { error: error?.message ?? null };
    },
    []
  );

  const signOut = useCallback(async () => {
    await supabaseRef.current.auth.signOut();
    setUser(null);
    setProfile(null);
  }, []);

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
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
