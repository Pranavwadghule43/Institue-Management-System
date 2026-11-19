-- The account-cap trigger locks the singleton row with SELECT FOR UPDATE.
-- PostgreSQL requires UPDATE on at least one column for that row lock.
-- The id column is constrained to 1. The maximums retain their existing grants.
GRANT UPDATE (id) ON TABLE public.account_limits TO ims_dhruvank_dev;
