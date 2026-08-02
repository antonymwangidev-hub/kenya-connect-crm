
REVOKE EXECUTE ON FUNCTION public.is_business_member(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.my_business_role(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.can_write_business(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.member_of_contact(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.can_write_contact(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.member_of_conversation(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.can_write_conversation(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.claim_membership() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.is_business_member(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.my_business_role(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_write_business(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.member_of_contact(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_write_contact(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.member_of_conversation(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_write_conversation(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_membership() TO authenticated, service_role;
