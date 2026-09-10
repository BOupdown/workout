/** Public Supabase configuration. Kept in one place so a missing deployment
 * variable becomes an actionable setup error rather than a failed request. */
export interface SupabaseConfig {
  url: string;
  publishableKey: string;
}

export function supabaseConfig(): SupabaseConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) return null;
  return { url, publishableKey };
}
