import { createClient } from './server';

/**
 * Verify the request's Supabase session with Auth, rather than trusting
 * client-supplied user IDs or merely decoding a JWT without validation.
 * Errors fail closed; no privileged operation is attempted without a user.
 */
export async function authenticatedUser(): Promise<{ id: string; email?: string } | null> {
  try {
    const client = await createClient();
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) return null;
    return { id: data.user.id, email: data.user.email };
  } catch {
    return null;
  }
}
