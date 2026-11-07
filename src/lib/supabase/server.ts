import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { serverEnv } from '@/lib/env';

/** Server-side Supabase client bound to the request cookie store. */
export async function createClient() {
  const env = serverEnv();
  const cookieStore = await cookies();

  return createServerClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component: cookies are read-only, safe to ignore.
        }
      },
    },
  });
}
