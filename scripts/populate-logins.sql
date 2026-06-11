-- Populate logins.telegram (from username) and logins.google (from email)
-- for all real user accounts (type = internal or external).
--
-- Existing entries in logins take precedence — already-set values are not
-- overwritten. Users with no email get only telegram populated.
--
-- Run against the Authentik PostgreSQL database:
--   psql "$DATABASE_URL" -f scripts/populate-logins.sql

UPDATE authentik_core_user
SET attributes =
    -- Preserve all other top-level attribute keys
    COALESCE(attributes, '{}')
    || jsonb_build_object(
        'forest_school',
        -- Preserve all other forest_school keys (name_frozen, user-defined, …)
        COALESCE(attributes -> 'forest_school', '{}')
        || jsonb_build_object(
            'logins',
            -- Build defaults: telegram from username, google from email (if non-empty).
            -- jsonb_strip_nulls removes google when email is blank.
            jsonb_strip_nulls(jsonb_build_object(
                'telegram', username,
                'google',   NULLIF(email, '')
            ))
            ||
            -- Existing struct-format logins override the defaults above,
            -- so already-set values are never clobbered.
            CASE jsonb_typeof(attributes -> 'forest_school' -> 'logins')
                WHEN 'object' THEN attributes -> 'forest_school' -> 'logins'
                ELSE '{}'::jsonb
            END
        )
    )
WHERE
    type IN ('internal', 'external');
