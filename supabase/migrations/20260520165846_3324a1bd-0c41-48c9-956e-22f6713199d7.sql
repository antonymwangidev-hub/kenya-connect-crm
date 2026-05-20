
revoke execute on function public.owns_business(uuid) from anon, authenticated, public;
revoke execute on function public.owns_contact(uuid) from anon, authenticated, public;
revoke execute on function public.handle_new_user() from anon, authenticated, public;
