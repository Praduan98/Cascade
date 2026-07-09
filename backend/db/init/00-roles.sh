#!/bin/bash
# Postgres container init (runs once, as the superuser, before migrations).
# Creates the three roles that make RLS actually bite:
#   - cascade_owner        : owns the schema + tables; Alembic connects as this. LOGIN.
#   - cascade_rls_definer  : owns the SECURITY DEFINER helpers; BYPASSRLS so those
#                            helpers never recurse through policies. NOLOGIN.
#   - cascade_app          : the FastAPI + Celery connection role. NOSUPERUSER,
#                            NOBYPASSRLS, so every query it runs is RLS-constrained.
# Roles must be created by the superuser here (only a superuser can grant BYPASSRLS);
# migrations run as cascade_owner and cannot create such roles themselves.
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE ROLE cascade_owner LOGIN PASSWORD '${CASCADE_OWNER_PASSWORD}';
    CREATE ROLE cascade_rls_definer NOLOGIN BYPASSRLS;
    CREATE ROLE cascade_app LOGIN PASSWORD '${CASCADE_APP_PASSWORD}' NOSUPERUSER NOBYPASSRLS;

    -- owner needs membership in the definer role to set function ownership in migrations,
    -- and in app to manage its default privileges/grants.
    GRANT cascade_rls_definer TO cascade_owner;
    GRANT cascade_app TO cascade_owner;

    -- hand the database + public schema to the owner so Alembic (as owner) can build everything.
    ALTER DATABASE cascade OWNER TO cascade_owner;
    GRANT ALL ON SCHEMA public TO cascade_owner;
    ALTER SCHEMA public OWNER TO cascade_owner;
EOSQL

echo "cascade roles created: cascade_owner, cascade_rls_definer, cascade_app"
