import { createClient } from '@supabase/supabase-js';
import { serverEnv } from '@/lib/env';

/**
 * Service-role Supabase client. Bypasses RLS - only use in trusted server code
 * (webhooks, admin routes). Returns null when no service-role key is configured.
 */
export function createAdminClient() {
  const key = serverEnv().SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return createClient(serverEnv().SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
