CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  login text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS roads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL DEFAULT '',
  road_type text NOT NULL CHECK (road_type IN ('residential', 'service', 'pedestrian', 'track', 'other')),
  surface text NOT NULL CHECK (surface IN ('asphalt', 'concrete', 'gravel', 'ground', 'unknown')),
  direction text NOT NULL CHECK (direction IN ('two_way', 'one_way')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  geometry geometry(LineString, 4326) NOT NULL,
  district_name text NOT NULL DEFAULT '',
  neighborhood_name text NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS road_change_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  road_id uuid NOT NULL REFERENCES roads(id),
  action text NOT NULL CHECK (action IN ('create', 'update', 'publish', 'archive', 'restore')),
  old_data jsonb,
  new_data jsonb,
  changed_by uuid NOT NULL REFERENCES users(id),
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS roads_geometry_gix ON roads USING gist (geometry);
CREATE INDEX IF NOT EXISTS roads_status_idx ON roads (status);
CREATE INDEX IF NOT EXISTS roads_name_search_idx ON roads USING gin (to_tsvector('simple', name));
CREATE INDEX IF NOT EXISTS road_change_log_road_idx ON road_change_log (road_id, changed_at DESC);
