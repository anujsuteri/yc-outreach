import { createClient } from '@supabase/supabase-js';

// Default Supabase config key in LocalStorage
const SUPABASE_CONFIG_KEY = 'reachyc_supabase_config';

// Retrieve saved config or process environment variables
export function getSupabaseConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem(SUPABASE_CONFIG_KEY) || '{}');
    const url = saved.url || (typeof process !== 'undefined' ? process.env?.VITE_SUPABASE_URL || process.env?.SUPABASE_URL : '') || '';
    const anonKey = saved.key || (typeof process !== 'undefined' ? process.env?.VITE_SUPABASE_ANON_KEY || process.env?.SUPABASE_ANON_KEY : '') || '';
    return { url, key: anonKey };
  } catch {
    return { url: '', key: '' };
  }
}

export function saveSupabaseConfig(url, key) {
  try {
    localStorage.setItem(SUPABASE_CONFIG_KEY, JSON.stringify({ url, key }));
  } catch (e) {
    console.error('Failed to save Supabase config:', e);
  }
}

export function getSupabaseClient() {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) {
    return null;
  }
  try {
    return createClient(url, key);
  } catch (e) {
    console.error('Error creating Supabase client:', e);
    return null;
  }
}

// Test Supabase Connection
export async function testSupabaseConnection(url, key) {
  if (!url || !key) return { success: false, message: 'URL and Key are required' };
  try {
    const client = createClient(url, key);
    // Simple ping query
    const { data, error } = await client.from('reachyc_outreach').select('count', { count: 'exact', head: true });
    if (error && error.code !== '42P01') { // 42P01 is relation does not exist, which means connected to Supabase DB!
      throw error;
    }
    return { success: true, message: 'Successfully connected to Supabase!' };
  } catch (err) {
    return { success: false, message: err.message || 'Connection failed' };
  }
}
