-- ==============================================================================
-- ReachYC - Supabase PostgreSQL Database Schema
-- Run this script in your Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql
-- ==============================================================================

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ------------------------------------------------------------------------------
-- 1. Profiles Table (Synced with Supabase Auth)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email TEXT NOT NULL,
  full_name TEXT,
  portfolio_url TEXT,
  github_url TEXT,
  resume_url TEXT,
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- ------------------------------------------------------------------------------
-- 2. Outreach Leads & Sent Emails Table (reachyc_outreach)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reachyc_outreach (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  company_name TEXT NOT NULL,
  startup_slug TEXT,
  founder_name TEXT,
  email TEXT NOT NULL,
  status TEXT DEFAULT 'sent' CHECK (status IN ('sent', 'drafted', 'replied', 'bounced')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  CONSTRAINT reachyc_outreach_email_unique UNIQUE (email)
);

-- ------------------------------------------------------------------------------
-- 3. Email Templates Table (reachyc_templates)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reachyc_templates (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  template_name TEXT NOT NULL DEFAULT 'default',
  subject TEXT,
  body TEXT,
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  CONSTRAINT reachyc_templates_name_unique UNIQUE (template_name)
);

-- ------------------------------------------------------------------------------
-- 4. Enable Row Level Security (RLS)
-- ------------------------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reachyc_outreach ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reachyc_templates ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------------------
-- 5. Row Level Security Policies
-- ------------------------------------------------------------------------------

-- Profiles: Users can view and manage their own profiles
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON public.profiles;
CREATE POLICY "Public profiles are viewable by everyone" 
  ON public.profiles FOR SELECT 
  USING (true);

DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile" 
  ON public.profiles FOR INSERT 
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" 
  ON public.profiles FOR UPDATE 
  USING (auth.uid() = id);

-- Outreach Leads: Allow access via Supabase anon key and authenticated users
DROP POLICY IF EXISTS "Allow anon and authenticated to view outreach leads" ON public.reachyc_outreach;
CREATE POLICY "Allow anon and authenticated to view outreach leads" 
  ON public.reachyc_outreach FOR SELECT 
  USING (true);

DROP POLICY IF EXISTS "Allow anon and authenticated to insert outreach leads" ON public.reachyc_outreach;
CREATE POLICY "Allow anon and authenticated to insert outreach leads" 
  ON public.reachyc_outreach FOR INSERT 
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow anon and authenticated to update outreach leads" ON public.reachyc_outreach;
CREATE POLICY "Allow anon and authenticated to update outreach leads" 
  ON public.reachyc_outreach FOR UPDATE 
  USING (true);

DROP POLICY IF EXISTS "Allow anon and authenticated to delete outreach leads" ON public.reachyc_outreach;
CREATE POLICY "Allow anon and authenticated to delete outreach leads" 
  ON public.reachyc_outreach FOR DELETE 
  USING (true);

-- Templates: Allow access via Supabase anon key and authenticated users
DROP POLICY IF EXISTS "Allow anon and authenticated to view templates" ON public.reachyc_templates;
CREATE POLICY "Allow anon and authenticated to view templates" 
  ON public.reachyc_templates FOR SELECT 
  USING (true);

DROP POLICY IF EXISTS "Allow anon and authenticated to insert templates" ON public.reachyc_templates;
CREATE POLICY "Allow anon and authenticated to insert templates" 
  ON public.reachyc_templates FOR INSERT 
  WITH CHECK (true);

DROP POLICY IF EXISTS "Allow anon and authenticated to update templates" ON public.reachyc_templates;
CREATE POLICY "Allow anon and authenticated to update templates" 
  ON public.reachyc_templates FOR UPDATE 
  USING (true);

-- ------------------------------------------------------------------------------
-- 6. Auth Trigger for Automatic User Profile Creation
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name'
  )
  ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email,
      full_name = COALESCE(EXCLUDED.full_name, profiles.full_name),
      updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- ------------------------------------------------------------------------------
-- 7. High Performance Database Indexes
-- ------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_reachyc_outreach_email ON public.reachyc_outreach(email);
CREATE INDEX IF NOT EXISTS idx_reachyc_outreach_user ON public.reachyc_outreach(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reachyc_outreach_company ON public.reachyc_outreach(company_name);
CREATE INDEX IF NOT EXISTS idx_reachyc_templates_name ON public.reachyc_templates(template_name);
