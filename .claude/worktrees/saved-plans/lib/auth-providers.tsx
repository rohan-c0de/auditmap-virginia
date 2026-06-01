import type { ComponentType, SVGProps } from "react";

// ---------------------------------------------------------------------------
// SSO Provider Configuration
// ---------------------------------------------------------------------------
// To add a new provider:
//   1. Enable it in the Supabase dashboard (Auth > Providers) and add credentials
//   2. Add an entry to AUTH_PROVIDERS below
// That's it — no other code changes needed.
// ---------------------------------------------------------------------------

export interface AuthProvider {
  /** Supabase provider ID (must match Supabase's provider name) */
  id: string;
  /** Button label shown in the login modal */
  label: string;
  /** SVG icon component */
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** Whether this provider is currently enabled */
  enabled: boolean;
}

// Google icon as inline SVG component
function GoogleIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" {...props}>
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}

// Future: Apple, GitHub, Microsoft icons would go here
// function AppleIcon(props: SVGProps<SVGSVGElement>) { ... }
// function GitHubIcon(props: SVGProps<SVGSVGElement>) { ... }

export const AUTH_PROVIDERS: AuthProvider[] = [
  {
    id: "google",
    label: "Continue with Google",
    icon: GoogleIcon,
    enabled: true,
  },
  // To add more providers, just add entries here:
  // { id: "apple", label: "Continue with Apple", icon: AppleIcon, enabled: true },
  // { id: "github", label: "Continue with GitHub", icon: GitHubIcon, enabled: true },
];

/** Returns only the providers that are currently enabled */
export function getEnabledProviders(): AuthProvider[] {
  return AUTH_PROVIDERS.filter((p) => p.enabled);
}
