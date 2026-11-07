'use client';

import { createBrowserClient } from '@supabase/ssr';
import { publicEnv } from '@/lib/env';

/** Browser-side Supabase client (uses the publishable/anon key). */
export function createClient() {
  return createBrowserClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey);
}
