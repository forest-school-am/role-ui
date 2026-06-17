-- Migrate the google_sync uniqueness side-table and trigger from the old flat
-- key layout:
--
--     attributes -> 'forest_school' -> 'google_sync' ->> 'recursive_name'
--     attributes -> 'forest_school' -> 'google_sync' ->> 'direct_name'
--
-- to the new nested layout (GoogleGroupConfig per slot):
--
--     attributes -> 'forest_school' -> 'google_sync' -> 'recursive' ->> 'email'
--     attributes -> 'forest_school' -> 'google_sync' -> 'direct'    ->> 'email'
--
-- Uniqueness is now enforced on the email local-part, not the display name.
-- The side-table column is renamed from `name` to `email` accordingly.

BEGIN;

-- Step 1: Promote flat recursive_name / direct_name values into the new nested
-- structure on any group that still has the old layout.  The old value becomes
-- the `email` field of the corresponding GoogleGroupConfig object; name and
-- description are left absent (NULL / empty) for the leader to fill in later.
-- Groups that already have the nested layout are untouched.
UPDATE authentik_core_group
SET attributes = attributes #-
        '{forest_school,google_sync,recursive_name}' #-
        '{forest_school,google_sync,direct_name}'
    ||
    jsonb_build_object('forest_school', jsonb_build_object('google_sync',
        (attributes -> 'forest_school' -> 'google_sync')
        - 'recursive_name' - 'direct_name'
        ||
        CASE WHEN (attributes -> 'forest_school' -> 'google_sync' ->> 'recursive_name') IS NOT NULL
             THEN jsonb_build_object('recursive', jsonb_build_object(
                      'email',       attributes -> 'forest_school' -> 'google_sync' ->> 'recursive_name',
                      'description', ''
                  ))
             ELSE '{}'::jsonb
        END
        ||
        CASE WHEN (attributes -> 'forest_school' -> 'google_sync' ->> 'direct_name') IS NOT NULL
             THEN jsonb_build_object('direct', jsonb_build_object(
                      'email',       attributes -> 'forest_school' -> 'google_sync' ->> 'direct_name',
                      'description', ''
                  ))
             ELSE '{}'::jsonb
        END
    ))
WHERE (attributes -> 'forest_school' -> 'google_sync' ->> 'recursive_name') IS NOT NULL
   OR (attributes -> 'forest_school' -> 'google_sync' ->> 'direct_name')    IS NOT NULL;

-- Step 2: Rename the side-table column.
ALTER TABLE forest_school_google_sync_uniqueness
    RENAME COLUMN name TO email;

-- Step 3: Replace the trigger function with one that reads the new paths.
CREATE OR REPLACE FUNCTION forest_school_google_sync_uniqueness_refresh()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    rec_email text;
    dir_email text;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        DELETE FROM forest_school_google_sync_uniqueness
        WHERE group_uuid = OLD.group_uuid;
    END IF;

    IF TG_OP <> 'DELETE' THEN
        rec_email := NEW.attributes -> 'forest_school' -> 'google_sync' -> 'recursive' ->> 'email';
        dir_email := NEW.attributes -> 'forest_school' -> 'google_sync' -> 'direct'    ->> 'email';

        IF rec_email IS NOT NULL THEN
            INSERT INTO forest_school_google_sync_uniqueness (email, group_uuid, source)
            VALUES (rec_email, NEW.group_uuid, 'recursive');
        END IF;

        IF dir_email IS NOT NULL THEN
            INSERT INTO forest_school_google_sync_uniqueness (email, group_uuid, source)
            VALUES (dir_email, NEW.group_uuid, 'direct');
        END IF;
    END IF;

    RETURN NULL;
END;
$$;

-- Step 4: Rebuild the side-table from the now-unified JSON.
-- TRUNCATE does not fire row-level triggers, so no recursion.
TRUNCATE forest_school_google_sync_uniqueness;

INSERT INTO forest_school_google_sync_uniqueness (email, group_uuid, source)
SELECT v.email, g.group_uuid, v.source
FROM authentik_core_group g
CROSS JOIN LATERAL (VALUES
    (g.attributes -> 'forest_school' -> 'google_sync' -> 'recursive' ->> 'email', 'recursive'),
    (g.attributes -> 'forest_school' -> 'google_sync' -> 'direct'    ->> 'email', 'direct')
) AS v(email, source)
WHERE v.email IS NOT NULL;

COMMIT;

-- ---------------------------------------------------------------------------
-- Pre-flight: find existing email conflicts before running this migration.
-- Run this query first and resolve any duplicates.
-- ---------------------------------------------------------------------------
-- SELECT email, count(*) AS occurrences, array_agg(group_uuid) AS groups
-- FROM (
--     SELECT group_uuid,
--            attributes -> 'forest_school' -> 'google_sync' ->> 'recursive_name' AS email
--     FROM authentik_core_group
--     UNION ALL
--     SELECT group_uuid,
--            attributes -> 'forest_school' -> 'google_sync' ->> 'direct_name'
--     FROM authentik_core_group
--     UNION ALL
--     SELECT group_uuid,
--            attributes -> 'forest_school' -> 'google_sync' -> 'recursive' ->> 'email'
--     FROM authentik_core_group
--     UNION ALL
--     SELECT group_uuid,
--            attributes -> 'forest_school' -> 'google_sync' -> 'direct' ->> 'email'
--     FROM authentik_core_group
-- ) s
-- WHERE email IS NOT NULL
-- GROUP BY email
-- HAVING count(*) > 1;
