-- Enforce GLOBAL uniqueness of Google Workspace sync names across BOTH JSON
-- paths in a single shared namespace:
--
--     attributes -> 'forest_school' -> 'google_sync' ->> 'recursive_name'
--     attributes -> 'forest_school' -> 'google_sync' ->> 'direct_name'
--
-- A value may appear at most once across recursive_name AND direct_name across
-- ALL groups. A name used as a recursive_name therefore cannot be reused as
-- anyone's direct_name, and vice versa.
--
-- Why not a unique index / EXCLUDE on authentik_core_group directly?
--   * A composite unique index enforces pair-uniqueness, not per-value.
--   * Two partial unique indexes enforce rec-vs-rec and dir-vs-dir, but miss
--     the cross-field case (rec of one group == dir of another).
--   * An exclusion constraint compares the SAME expression across rows
--     (expr(r1) op expr(r2)); it cannot compare recursive_name(r1) against
--     direct_name(r2), so it cannot express the cross-field case either.
--   * Array-overlap (EXCLUDE USING gist (... WITH &&)) would express it, but
--     core Postgres has no GiST opclass for text[], and hashing text to int
--     risks false-positive collisions on a hard constraint.
--
-- Solution: unpivot both paths into one row-per-name side table, where a plain
-- PRIMARY KEY is the uniqueness namespace, kept in sync by a trigger. A
-- colliding write aborts its transaction at the DB level.

BEGIN;

-- One row per Google Workspace sync name, regardless of which JSON path it came
-- from. The PRIMARY KEY on `name` is the single shared uniqueness namespace.
CREATE TABLE IF NOT EXISTS forest_school_google_sync_uniqueness (
    name       text PRIMARY KEY,
    group_uuid uuid NOT NULL
        REFERENCES authentik_core_group (group_uuid) ON DELETE CASCADE,
    source     text NOT NULL CHECK (source IN ('recursive', 'direct'))
);

CREATE OR REPLACE FUNCTION forest_school_google_sync_uniqueness_refresh()
RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    rec_name text;
    dir_name text;
BEGIN
    -- Drop this group's previous names first (UPDATE / DELETE).
    IF TG_OP <> 'INSERT' THEN
        DELETE FROM forest_school_google_sync_uniqueness
        WHERE group_uuid = OLD.group_uuid;
    END IF;

    IF TG_OP <> 'DELETE' THEN
        rec_name := NEW.attributes -> 'forest_school' -> 'google_sync' ->> 'recursive_name';
        dir_name := NEW.attributes -> 'forest_school' -> 'google_sync' ->> 'direct_name';

        IF rec_name IS NOT NULL THEN
            INSERT INTO forest_school_google_sync_uniqueness (name, group_uuid, source)
            VALUES (rec_name, NEW.group_uuid, 'recursive');
        END IF;

        IF dir_name IS NOT NULL THEN
            -- A row whose recursive_name == direct_name collides with the
            -- insert above, which is the intended intra-group rejection.
            INSERT INTO forest_school_google_sync_uniqueness (name, group_uuid, source)
            VALUES (dir_name, NEW.group_uuid, 'direct');
        END IF;
    END IF;

    RETURN NULL;  -- AFTER trigger, return value ignored
END;
$$;

DROP TRIGGER IF EXISTS trg_forest_school_google_sync_uniqueness
    ON authentik_core_group;
CREATE TRIGGER trg_forest_school_google_sync_uniqueness
    AFTER INSERT OR UPDATE OF attributes OR DELETE ON authentik_core_group
    FOR EACH ROW EXECUTE FUNCTION forest_school_google_sync_uniqueness_refresh();

-- Backfill from existing data. Fails loudly with a unique_violation if current
-- data already contains duplicates across the two paths — run the detection
-- query at the bottom of this file and clean them up first.
INSERT INTO forest_school_google_sync_uniqueness (name, group_uuid, source)
SELECT v.name, g.group_uuid, v.source
FROM authentik_core_group g
CROSS JOIN LATERAL (VALUES
    (g.attributes -> 'forest_school' -> 'google_sync' ->> 'recursive_name', 'recursive'),
    (g.attributes -> 'forest_school' -> 'google_sync' ->> 'direct_name',    'direct')
) AS v(name, source)
WHERE v.name IS NOT NULL;

COMMIT;

-- ---------------------------------------------------------------------------
-- Pre-flight: find existing violations before running the backfill above.
-- ---------------------------------------------------------------------------
-- SELECT name, count(*) AS occurrences, array_agg(group_uuid) AS groups
-- FROM (
--     SELECT group_uuid,
--            attributes -> 'forest_school' -> 'google_sync' ->> 'recursive_name' AS name
--     FROM authentik_core_group
--     UNION ALL
--     SELECT group_uuid,
--            attributes -> 'forest_school' -> 'google_sync' ->> 'direct_name'
--     FROM authentik_core_group
-- ) s
-- WHERE name IS NOT NULL
-- GROUP BY name
-- HAVING count(*) > 1;
