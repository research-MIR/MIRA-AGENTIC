import { createClient } from '@supabase/supabase-js';

// Fallback values for local development. These are public keys and are safe to be exposed.
// In a production environment like Netlify, these will be overridden by environment variables.
const SUPABASE_URL_FALLBACK = 'https://ukxguvvbgjvukrsdnxmy.supabase.co';
const SUPABASE_ANON_KEY_FALLBACK = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVreGd1dnZiZ2p2dWtyc2RueG15Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU1NDM0NDcsImV4cCI6MjA2MTExOTQ0N30.KtJkyH9TW_KhLUIKMyHtVMNi3gqDX2Vz20UaFSta0-I';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || SUPABASE_URL_FALLBACK;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || SUPABASE_ANON_KEY_FALLBACK;

if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
  // This should not happen now, but it's a good safeguard.
  throw new Error("Supabase URL and/or Anon Key are missing. Please check your environment variables and fallback values.");
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);