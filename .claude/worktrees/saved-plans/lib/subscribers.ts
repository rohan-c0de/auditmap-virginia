import { getServiceClient } from "./supabase";

export interface Subscriber {
  id: number;
  email: string;
  state: string;
  verified: boolean;
  token: string;
  preferences: { newTerm: boolean };
  subscribed_at: string;
}

/**
 * Add a subscriber (or re-trigger verification for an existing unverified one).
 * Uses upsert on (email, state) unique constraint.
 */
export async function addSubscriber(
  state: string,
  email: string
): Promise<{
  subscriber: Subscriber;
  isNew: boolean;
  alreadyVerified: boolean;
}> {
  const sb = getServiceClient();

  // Check if subscriber already exists
  const { data: existing } = await sb
    .from("subscribers")
    .select("*")
    .eq("email", email)
    .eq("state", state)
    .single();

  if (existing) {
    if (existing.verified) {
      return {
        subscriber: existing as Subscriber,
        isNew: false,
        alreadyVerified: true,
      };
    }

    // Re-generate token for unverified subscriber (allows re-sending verification)
    const newToken = crypto.randomUUID();
    const { data: updated } = await sb
      .from("subscribers")
      .update({
        token: newToken,
        subscribed_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .select("*")
      .single();

    return {
      subscriber: (updated || existing) as Subscriber,
      isNew: false,
      alreadyVerified: false,
    };
  }

  // Insert new subscriber
  const { data: inserted, error } = await sb
    .from("subscribers")
    .insert({
      email,
      state,
      verified: false,
      preferences: { newTerm: true },
    })
    .select("*")
    .single();

  if (error) throw new Error(`Failed to add subscriber: ${error.message}`);

  return {
    subscriber: inserted as Subscriber,
    isNew: true,
    alreadyVerified: false,
  };
}

/**
 * Verify a subscriber by their token. Returns the subscriber if found, null otherwise.
 * Tokens expire after 24 hours (based on subscribed_at timestamp).
 */
export async function verifySubscriber(
  state: string,
  token: string
): Promise<Subscriber | null> {
  const sb = getServiceClient();

  // First, look up the subscriber to check token age
  const { data: existing, error: lookupErr } = await sb
    .from("subscribers")
    .select("*")
    .eq("state", state)
    .eq("token", token)
    .single();

  if (lookupErr || !existing) return null;

  // Check token expiry — tokens are valid for 24 hours from subscribed_at
  const TOKEN_MAX_AGE_MS = 24 * 60 * 60 * 1000;
  const tokenAge = Date.now() - new Date(existing.subscribed_at).getTime();
  if (tokenAge > TOKEN_MAX_AGE_MS) return null;

  // Token is valid — mark as verified
  const { data, error } = await sb
    .from("subscribers")
    .update({ verified: true })
    .eq("id", existing.id)
    .select("*")
    .single();

  if (error || !data) return null;
  return data as Subscriber;
}

/**
 * Remove a subscriber by email and state.
 * Returns true if a row was deleted.
 */
export async function removeSubscriber(
  state: string,
  email: string
): Promise<boolean> {
  const sb = getServiceClient();

  const { count } = await sb
    .from("subscribers")
    .delete({ count: "exact" })
    .eq("email", email)
    .eq("state", state);

  return (count || 0) > 0;
}

/**
 * Remove a subscriber by their unique token.
 * Returns true if a row was deleted.
 */
export async function removeSubscriberByToken(
  token: string
): Promise<boolean> {
  const sb = getServiceClient();

  const { count } = await sb
    .from("subscribers")
    .delete({ count: "exact" })
    .eq("token", token);

  return (count || 0) > 0;
}

/**
 * Get all verified subscribers for a given state.
 */
export async function getVerifiedSubscribers(
  state: string
): Promise<Subscriber[]> {
  const sb = getServiceClient();

  const { data } = await sb
    .from("subscribers")
    .select("email, state, token")
    .eq("state", state)
    .eq("verified", true);

  return (data || []) as Subscriber[];
}
