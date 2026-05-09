import { createClient } from '@supabase/supabase-js';

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL || '').trim();
const supabasePublishableKey = (
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || ''
).trim();
const hasSupabaseConfig = Boolean(supabaseUrl && supabasePublishableKey && supabasePublishableKey !== 'missing-publishable-key');

if (!hasSupabaseConfig) {
  console.warn(
    '[Supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY; auth/realtime calls will fail until configured.'
  );
} else {
  console.info('[Supabase] Client configured', {
    url: supabaseUrl,
    auth: 'enabled',
    realtime: 'enabled',
  });
}

export const supabase = createClient(
  supabaseUrl || 'http://localhost:54321',
  supabasePublishableKey || 'missing-publishable-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  }
);

supabase.auth.getSession().then(({ data, error }) => {
  if (error) {
    console.error('[Supabase] Initial session lookup failed', { message: error.message });
    return;
  }
  console.info('[Supabase] Initial session state', {
    hasSession: Boolean(data.session),
    userId: data.session?.user?.id || null,
  });
});
