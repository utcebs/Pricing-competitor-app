-- ============================================================
-- Admin user management via SECURITY DEFINER RPC functions.
-- Called from the client with supabase.rpc('admin_create_user', ...).
-- Guarded so only role='admin' can invoke.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Create a user (email, password, full_name, role). Returns the new UUID.
CREATE OR REPLACE FUNCTION admin_create_user(
  p_email     TEXT,
  p_password  TEXT,
  p_full_name TEXT DEFAULT NULL,
  p_role      TEXT DEFAULT 'viewer'
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth
AS $$
DECLARE
  new_user_id UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'Only admins can create users' USING ERRCODE = '42501';
  END IF;

  IF p_role NOT IN ('admin', 'manager', 'viewer') THEN
    RAISE EXCEPTION 'Invalid role: %', p_role USING ERRCODE = '22023';
  END IF;

  IF p_email IS NULL OR length(trim(p_email)) = 0 THEN
    RAISE EXCEPTION 'email is required' USING ERRCODE = '22023';
  END IF;

  IF p_password IS NULL OR length(p_password) < 6 THEN
    RAISE EXCEPTION 'password must be at least 6 characters' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (SELECT 1 FROM auth.users WHERE email = lower(trim(p_email))) THEN
    RAISE EXCEPTION 'A user with that email already exists' USING ERRCODE = '23505';
  END IF;

  new_user_id := gen_random_uuid();

  INSERT INTO auth.users (
    id, instance_id, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, aud, role,
    created_at, updated_at
  ) VALUES (
    new_user_id,
    '00000000-0000-0000-0000-000000000000'::uuid,
    lower(trim(p_email)),
    crypt(p_password, gen_salt('bf')),
    NOW(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    'authenticated',
    'authenticated',
    NOW(),
    NOW()
  );

  -- Defensive: on_auth_user_created trigger should have made the profile.
  -- If not (e.g. trigger disabled), create it here.
  INSERT INTO profiles (id, email, full_name, role)
  VALUES (new_user_id, lower(trim(p_email)), p_full_name, p_role)
  ON CONFLICT (id) DO UPDATE
    SET role = EXCLUDED.role,
        full_name = COALESCE(EXCLUDED.full_name, profiles.full_name);

  RETURN new_user_id;
END;
$$;

-- Delete a user. Cascades to profiles via FK. Can't delete yourself.
CREATE OR REPLACE FUNCTION admin_delete_user(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'Only admins can delete users' USING ERRCODE = '42501';
  END IF;

  IF p_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot delete your own account' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_id) THEN
    RAISE EXCEPTION 'User not found' USING ERRCODE = '02000';
  END IF;

  DELETE FROM auth.users WHERE id = p_id;
END;
$$;

-- Reset a user's password. Useful when they forget or leave and rejoin.
CREATE OR REPLACE FUNCTION admin_reset_password(p_id UUID, p_new_password TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'Only admins can reset passwords' USING ERRCODE = '42501';
  END IF;

  IF p_new_password IS NULL OR length(p_new_password) < 6 THEN
    RAISE EXCEPTION 'password must be at least 6 characters' USING ERRCODE = '22023';
  END IF;

  UPDATE auth.users
    SET encrypted_password = crypt(p_new_password, gen_salt('bf')),
        updated_at = NOW()
  WHERE id = p_id;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_create_user(TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_delete_user(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION admin_reset_password(UUID, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
