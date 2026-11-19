-- Apply as the IMS schema owner after review. No existing tables or data are changed.
BEGIN;

CREATE TABLE public.whatsapp_document_deliveries (
    id uuid PRIMARY KEY,
    document_type varchar(12) NOT NULL CONSTRAINT whatsapp_delivery_document_type CHECK (document_type IN ('receipt', 'bill')),
    document_code varchar(40) NOT NULL,
    recipient varchar(15) NOT NULL CONSTRAINT whatsapp_delivery_recipient CHECK (recipient ~ '^[1-9][0-9]{7,14}$'),
    consent_by bigint NOT NULL REFERENCES public.users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    provider_timestamp bigint,
    provider_message_id varchar(255) UNIQUE,
    status varchar(12) NOT NULL CONSTRAINT whatsapp_delivery_status CHECK (status IN ('pending', 'submitted', 'sent', 'delivered', 'read', 'failed')),
    result_code varchar(50)
);
CREATE UNIQUE INDEX whatsapp_delivery_active_doc ON public.whatsapp_document_deliveries (document_type, document_code)
    WHERE status <> 'failed';
CREATE INDEX whatsapp_delivery_history ON public.whatsapp_document_deliveries (document_type, document_code, created_at);
ALTER TABLE public.whatsapp_document_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_document_deliveries FROM PUBLIC;
-- Supabase can grant these roles table access through owner default privileges.
DO $permissions$
DECLARE role_name text;
BEGIN
    FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
            EXECUTE format('REVOKE ALL ON public.whatsapp_document_deliveries FROM %I', role_name);
        END IF;
    END LOOP;
END;
$permissions$;

COMMIT;
