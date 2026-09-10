import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { supabaseConfig } from './config';

let browserClient: SupabaseClient | null = null;

/**
 * The browser client is deliberately created lazily. It lets the application
 * build and run locally before a Supabase project has been connected, while
 * making every cloud-only screen opt in explicitly to that dependency.
 */
export function getSupabaseClient(): SupabaseClient {
  if (browserClient) return browserClient;

  const config = supabaseConfig();
  if (!config) {
    throw new Error(
      'Cloud sync is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.',
    );
  }

  browserClient = createClient(config.url, config.publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  return browserClient;
}
