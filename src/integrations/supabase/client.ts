import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
  console.error("Supabase URL and/or Anon Key are missing from environment variables.");
  // We don't throw an error here to avoid crashing the build process on Netlify
  // if the variables are not immediately available, but we log a clear error.
}

// The client will be initialized with potentially undefined values if the env vars are missing,
// but Supabase will throw a clear error in the browser console when an API call is attempted.
export const supabase = createClient(SUPABASE_URL!, SUPABASE_PUBLISHABLE_KEY!);