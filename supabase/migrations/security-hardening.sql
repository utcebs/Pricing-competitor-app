-- ============================================================
-- Security hardening — closes two real holes found in the audit.
--
--  1. PRIVILEGE ESCALATION (critical): the p_profiles_self_update policy lets a
--     user UPDATE their own profiles row, and nothing stopped them setting
--     role='admin' on themselves. A row-level WITH CHECK can't compare OLD vs
--     NEW, so we guard the role column with a trigger instead.
--
--  2. SECRET EXPOSURE (high): integrations.config holds clientSecret /
--     accessToken, and integration_sync_log holds request/response payloads.
--     Both were readable by EVERY authenticated user (incl. read-only viewers).
--     Restrict reads to admins.
--
-- Safe to re-run.
-- ============================================================

-- ── 1. Block role self-escalation ───────────────────────────
-- A logged-in non-admin may still edit their own name/etc (the existing
-- self-update policy), but may NOT change `role`. Admins and trusted backend
-- contexts (service_role / SECURITY DEFINER admin functions, where auth.uid()
-- is null) are unaffected, so the admin user-management flow keeps working.
CREATE OR REPLACE FUNCTION public.guard_profile_privilege_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (NEW.role IS DISTINCT FROM OLD.role)
     AND auth.uid() IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.profiles p
                     WHERE p.id = auth.uid() AND p.role = 'admin') THEN
    RAISE EXCEPTION 'Only an admin can change a profile role';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_profile_privilege ON public.profiles;
CREATE TRIGGER trg_guard_profile_privilege
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_privilege_change();

-- ── 2. Restrict secret-bearing tables to admins ─────────────
DROP POLICY IF EXISTS p_int_read ON public.integrations;
CREATE POLICY p_int_read ON public.integrations FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.profiles
                 WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS p_isl_read ON public.integration_sync_log;
CREATE POLICY p_isl_read ON public.integration_sync_log FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.profiles
                 WHERE id = auth.uid() AND role = 'admin'));

NOTIFY pgrst, 'reload schema';
