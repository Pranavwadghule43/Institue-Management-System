-- Existing bills have no stored service login username. A nullable column preserves those records.
ALTER TABLE public.service_bills ADD COLUMN service_login_username varchar(256);
