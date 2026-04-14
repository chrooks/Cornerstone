-- Creates the user_roles table for multi-admin role management.
-- To grant admin access: insert a row via Supabase Dashboard or a service-role script.
-- e.g.: INSERT INTO public.user_roles (user_id) VALUES ('<your-auth-user-uuid>');

CREATE TABLE public.user_roles (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'admin',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read their own role row (used by the admin layout to verify access)
CREATE POLICY "Users can read own role"
  ON public.user_roles
  FOR SELECT
  USING (auth.uid() = user_id);

-- Only the service role (backend, Supabase dashboard) can create or modify role records
CREATE POLICY "Service role manages roles"
  ON public.user_roles
  FOR ALL
  USING (auth.role() = 'service_role');
