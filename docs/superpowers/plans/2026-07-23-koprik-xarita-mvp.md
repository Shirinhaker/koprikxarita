# Ko‘prik Xarita MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a separate responsive Surxondaryo map editor where an administrator can draw, name, save, edit, publish, search, archive, and restore roads while viewers only see published roads.

**Architecture:** Use an npm-workspaces monorepo with a React/TypeScript/Vite web application, an Express/TypeScript API, and a shared Zod schema package. The API depends on a repository interface: production uses PostgreSQL/PostGIS, while automated tests use an in-memory repository. MapLibre renders the basemap and published-road GeoJSON; Terra Draw manages `LineString` drawing and vertex editing.

**Tech Stack:** Node.js 22+, npm workspaces, React 19, TypeScript, Vite 8, MapLibre GL JS 5, Terra Draw 1, Express 5, PostgreSQL 16 + PostGIS 3, Zod, Vitest, Supertest, React Testing Library.

## Global Constraints

- The project stays separate from Ko‘prik/Platforma.
- The first release is a responsive web application, not a native mobile app.
- The map starts centered on Surxondaryo.
- Road geometry is stored as PostGIS `LINESTRING` with SRID 4326.
- Road states are exactly `draft`, `published`, and `archived`.
- Viewer accounts can only read published roads.
- Administrator write operations require authentication and role checks.
- A road needs at least two coordinates.
- A road may be saved as a draft without a formal name, but publishing requires a non-empty name.
- Deletion archives a road instead of physically deleting it.
- OSM attribution remains accessible through a compact information control.
- The basemap URL is configurable so a future `surxondaryo.pmtiles` source can replace the development basemap without changing editor logic.

---

## Planned File Structure

```text
koprik-xarita/
├── apps/
│   ├── api/
│   │   ├── src/
│   │   │   ├── app.ts
│   │   │   ├── server.ts
│   │   │   ├── config.ts
│   │   │   ├── auth/
│   │   │   ├── roads/
│   │   │   └── database/
│   │   └── tests/
│   └── web/
│       ├── src/
│       │   ├── api/
│       │   ├── components/
│       │   ├── features/map-editor/
│       │   └── styles/
│       └── tests/
├── packages/shared/src/
├── database/migrations/
├── database/seeds/
├── docs/
├── docker-compose.yml
├── package.json
└── README.md
```

## Task 1: Workspace, Shared Domain Types, and Validation

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/roads.ts`
- Create: `packages/shared/src/index.ts`
- Test: `packages/shared/src/roads.test.ts`

**Interfaces:**
- Produces: `Road`, `RoadFeature`, `RoadCollection`, `RoadInput`, `roadInputSchema`, `publishRoadSchema`, `roadSearchSchema`, and enum constants shared by API and web.

- [ ] **Step 1: Create the workspace manifests and strict TypeScript configuration.**

```json
{
  "name": "koprik-xarita",
  "private": true,
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "dev": "concurrently -n api,web npm:dev:api npm:dev:web",
    "dev:api": "npm run dev -w @koprik-xarita/api",
    "dev:web": "npm run dev -w @koprik-xarita/web",
    "build": "npm run build -ws --if-present",
    "test": "npm run test -ws --if-present",
    "typecheck": "npm run typecheck -ws --if-present"
  }
}
```

- [ ] **Step 2: Write failing validation tests.**

```ts
import { describe, expect, it } from "vitest";
import { roadInputSchema } from "./roads";

describe("roadInputSchema", () => {
  it("rejects a LineString with fewer than two positions", () => {
    const result = roadInputSchema.safeParse({
      name: "Sinov ko‘chasi",
      roadType: "residential",
      surface: "asphalt",
      direction: "two_way",
      status: "draft",
      districtName: "Qumqo‘rg‘on",
      neighborhoodName: "",
      geometry: { type: "LineString", coordinates: [[67.1, 37.8]] },
    });
    expect(result.success).toBe(false);
  });

  it("accepts a draft road without a name", () => {
    const result = roadInputSchema.safeParse({
      name: "",
      roadType: "service",
      surface: "ground",
      direction: "two_way",
      status: "draft",
      districtName: "Qumqo‘rg‘on",
      neighborhoodName: "",
      geometry: {
        type: "LineString",
        coordinates: [[67.1, 37.8], [67.101, 37.801]],
      },
    });
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 3: Run the shared tests and verify failure.**

Run: `npm test -w @koprik-xarita/shared`
Expected: FAIL because `roadInputSchema` does not exist.

- [ ] **Step 4: Implement exact shared enums, schemas, and GeoJSON types.**

```ts
import { z } from "zod";

export const roadTypes = ["residential", "service", "pedestrian", "track", "other"] as const;
export const surfaces = ["asphalt", "concrete", "gravel", "ground", "unknown"] as const;
export const directions = ["two_way", "one_way"] as const;
export const roadStatuses = ["draft", "published", "archived"] as const;

const positionSchema = z.tuple([
  z.number().min(-180).max(180),
  z.number().min(-90).max(90),
]);

export const lineStringSchema = z.object({
  type: z.literal("LineString"),
  coordinates: z.array(positionSchema).min(2).max(5000),
});

export const roadInputSchema = z.object({
  name: z.string().trim().max(180),
  roadType: z.enum(roadTypes),
  surface: z.enum(surfaces),
  direction: z.enum(directions),
  status: z.enum(roadStatuses),
  districtName: z.string().trim().max(120),
  neighborhoodName: z.string().trim().max(120),
  geometry: lineStringSchema,
  expectedUpdatedAt: z.string().datetime().optional(),
});
```

- [ ] **Step 5: Run shared tests and typecheck.**

Run: `npm test -w @koprik-xarita/shared && npm run typecheck -w @koprik-xarita/shared`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add package.json tsconfig.base.json .gitignore .env.example packages/shared
git commit -m "feat: define shared road domain"
```

## Task 2: Database Schema, Seed Admin, and Repository Contract

**Files:**
- Create: `docker-compose.yml`
- Create: `database/migrations/001_init.sql`
- Create: `database/seeds/001_admin.sql`
- Create: `apps/api/src/roads/road-repository.ts`
- Create: `apps/api/src/roads/in-memory-road-repository.ts`
- Test: `apps/api/src/roads/in-memory-road-repository.test.ts`

**Interfaces:**
- Consumes: `Road`, `RoadInput` from `@koprik-xarita/shared`.
- Produces: `RoadRepository` with `list`, `getById`, `create`, `update`, `archive`, `restore`, `publish`, and `search` methods.

- [ ] **Step 1: Write repository behavior tests for persistence, optimistic locking, search, archive, and restore.**

```ts
it("rejects an update with a stale updatedAt value", async () => {
  const created = await repository.create(validInput, adminUser);
  await repository.update(created.id, { ...validInput, name: "Yangi nom", expectedUpdatedAt: created.updatedAt }, adminUser);
  await expect(
    repository.update(created.id, { ...validInput, name: "Eski so‘rov", expectedUpdatedAt: created.updatedAt }, adminUser),
  ).rejects.toMatchObject({ code: "ROAD_CONFLICT" });
});
```

- [ ] **Step 2: Run the repository test and verify failure.**

Run: `npm test -w @koprik-xarita/api -- in-memory-road-repository.test.ts`
Expected: FAIL because the repository is missing.

- [ ] **Step 3: Define the repository interface and in-memory implementation used by tests.**

```ts
export interface RoadRepository {
  list(status: RoadStatus | "all"): Promise<Road[]>;
  getById(id: string): Promise<Road | null>;
  create(input: RoadInput, actor: AuthUser): Promise<Road>;
  update(id: string, input: RoadInput, actor: AuthUser): Promise<Road>;
  publish(id: string, actor: AuthUser): Promise<Road>;
  archive(id: string, actor: AuthUser): Promise<Road>;
  restore(id: string, actor: AuthUser): Promise<Road>;
  search(query: string, status: RoadStatus | "all"): Promise<Road[]>;
}
```

- [ ] **Step 4: Add PostGIS tables and indexes.**

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  login text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE roads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL DEFAULT '',
  road_type text NOT NULL,
  surface text NOT NULL,
  direction text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  geometry geometry(LineString, 4326) NOT NULL,
  district_name text NOT NULL DEFAULT '',
  neighborhood_name text NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX roads_geometry_gix ON roads USING gist (geometry);
CREATE INDEX roads_name_search_idx ON roads USING gin (to_tsvector('simple', name));
```

- [ ] **Step 5: Run repository tests.**

Run: `npm test -w @koprik-xarita/api -- in-memory-road-repository.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add docker-compose.yml database apps/api/src/roads/road-repository.ts apps/api/src/roads/in-memory-road-repository*
git commit -m "feat: add road persistence contract"
```

## Task 3: API Authentication, Authorization, and Road Endpoints

**Files:**
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/src/config.ts`
- Create: `apps/api/src/app.ts`
- Create: `apps/api/src/server.ts`
- Create: `apps/api/src/auth/auth-service.ts`
- Create: `apps/api/src/auth/auth-middleware.ts`
- Create: `apps/api/src/roads/road-routes.ts`
- Create: `apps/api/src/roads/road-service.ts`
- Create: `apps/api/src/database/postgres-road-repository.ts`
- Create: `apps/api/src/database/pool.ts`
- Test: `apps/api/tests/auth.test.ts`
- Test: `apps/api/tests/roads-api.test.ts`

**Interfaces:**
- Consumes: `RoadRepository`, `roadInputSchema`, `roadSearchSchema`.
- Produces REST routes under `/api`, JWT authentication, and GeoJSON road responses.

- [ ] **Step 1: Write failing Supertest cases.**

```ts
it("blocks a viewer from creating a road", async () => {
  const response = await request(app)
    .post("/api/roads")
    .set("Authorization", `Bearer ${viewerToken}`)
    .send(validInput);
  expect(response.status).toBe(403);
});

it("requires a name when publishing", async () => {
  const road = await repository.create({ ...validInput, name: "" }, adminUser);
  const response = await request(app)
    .post(`/api/roads/${road.id}/publish`)
    .set("Authorization", `Bearer ${adminToken}`);
  expect(response.status).toBe(422);
});
```

- [ ] **Step 2: Run API tests and verify failure.**

Run: `npm test -w @koprik-xarita/api -- roads-api.test.ts auth.test.ts`
Expected: FAIL because the app and routes are missing.

- [ ] **Step 3: Implement JWT login and `requireRole('admin')`.**

```ts
export function requireRole(role: "admin" | "viewer") {
  return (request: AuthenticatedRequest, response: Response, next: NextFunction) => {
    if (!request.user) return response.status(401).json({ message: "Kirish talab qilinadi" });
    if (request.user.role !== role) return response.status(403).json({ message: "Ruxsat berilmagan" });
    next();
  };
}
```

- [ ] **Step 4: Implement road service state transitions and validation.**

```ts
export async function publishRoad(repository: RoadRepository, id: string, actor: AuthUser) {
  const road = await repository.getById(id);
  if (!road) throw new AppError(404, "ROAD_NOT_FOUND", "Ko‘cha topilmadi");
  if (!road.name.trim()) throw new AppError(422, "ROAD_NAME_REQUIRED", "Nashr qilish uchun ko‘cha nomi kerak");
  return repository.publish(id, actor);
}
```

- [ ] **Step 5: Implement PostGIS conversion with parameterized SQL.**

```sql
INSERT INTO roads (..., geometry, ...)
VALUES (..., ST_SetSRID(ST_GeomFromGeoJSON($6), 4326), ...)
RETURNING id, ..., ST_AsGeoJSON(geometry)::json AS geometry;
```

- [ ] **Step 6: Implement exact endpoints from the approved design plus `POST /api/roads/:id/restore`.**

- [ ] **Step 7: Run API tests, typecheck, and build.**

Run: `npm test -w @koprik-xarita/api && npm run typecheck -w @koprik-xarita/api && npm run build -w @koprik-xarita/api`
Expected: PASS.

- [ ] **Step 8: Commit.**

```bash
git add apps/api
git commit -m "feat: expose secured road API"
```

## Task 4: Responsive Map Shell and Configurable Basemap

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/index.html`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/App.tsx`
- Create: `apps/web/src/config.ts`
- Create: `apps/web/src/features/map-editor/MapCanvas.tsx`
- Create: `apps/web/src/features/map-editor/map-style.ts`
- Create: `apps/web/src/styles/global.css`
- Test: `apps/web/src/App.test.tsx`

**Interfaces:**
- Produces: `MapCanvas` exposing a MapLibre map instance through `onMapReady(map)` and a configurable `VITE_MAP_STYLE_URL`/`VITE_PMTILES_URL` basemap selection.

- [ ] **Step 1: Write a failing responsive shell test.**

```tsx
it("shows search, map, and administrator controls", () => {
  render(<App />);
  expect(screen.getByRole("searchbox", { name: /ko‘cha qidirish/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /ko‘cha chizish/i })).toBeInTheDocument();
  expect(screen.getByTestId("map-canvas")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the web test and verify failure.**

Run: `npm test -w @koprik-xarita/web -- App.test.tsx`
Expected: FAIL because `App` is missing.

- [ ] **Step 3: Build the desktop sidebar and mobile bottom-sheet shell.**

- [ ] **Step 4: Initialize MapLibre centered at `[67.27, 37.94]`, zoom `8`.**

```ts
const map = new Map({
  container: mapElement,
  style: resolveBasemapStyle(config),
  center: [67.27, 37.94],
  zoom: 8,
  attributionControl: false,
  maplibreLogo: false,
});
```

- [ ] **Step 5: Add a compact custom attribution control that remains accessible.**

```ts
map.addControl(new AttributionControl({ compact: true, customAttribution: "Xarita ma’lumotlari: OpenStreetMap" }), "bottom-right");
```

- [ ] **Step 6: Run web tests, typecheck, and build.**

Run: `npm test -w @koprik-xarita/web && npm run typecheck -w @koprik-xarita/web && npm run build -w @koprik-xarita/web`
Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add apps/web
git commit -m "feat: add responsive map shell"
```

## Task 5: Road Data Client, GeoJSON Layer, Selection, and Search

**Files:**
- Create: `apps/web/src/api/http.ts`
- Create: `apps/web/src/api/roads.ts`
- Create: `apps/web/src/features/map-editor/useRoads.ts`
- Create: `apps/web/src/features/map-editor/RoadLayer.tsx`
- Create: `apps/web/src/features/map-editor/SearchBox.tsx`
- Test: `apps/web/src/features/map-editor/SearchBox.test.tsx`
- Test: `apps/web/src/features/map-editor/road-layer.test.ts`

**Interfaces:**
- Consumes: `/api/roads`, `/api/roads/search`.
- Produces: `useRoads()`, `searchRoads(query)`, a `RoadLayer` that updates a MapLibre GeoJSON source, and `onSelectRoad(roadId)`.

- [ ] **Step 1: Write failing tests for query debouncing and Road-to-FeatureCollection conversion.**

- [ ] **Step 2: Run tests and verify failure.**

- [ ] **Step 3: Implement typed fetch helpers with user-facing Uzbek errors.**

- [ ] **Step 4: Add published-road source and selected-road highlight layers.**

```ts
map.addLayer({
  id: "published-roads",
  type: "line",
  source: "roads",
  paint: { "line-color": "#2855d9", "line-width": ["interpolate", ["linear"], ["zoom"], 8, 2, 16, 7] },
});
```

- [ ] **Step 5: Implement name search, result count, fly-to bounds, and selection details.**

- [ ] **Step 6: Run tests and commit.**

```bash
npm test -w @koprik-xarita/web
git add apps/web/src/api apps/web/src/features/map-editor
git commit -m "feat: display and search roads"
```

## Task 6: Terra Draw Line Creation and Form Preservation

**Files:**
- Create: `apps/web/src/features/map-editor/DrawController.ts`
- Create: `apps/web/src/features/map-editor/RoadForm.tsx`
- Create: `apps/web/src/features/map-editor/useEditorSession.ts`
- Test: `apps/web/src/features/map-editor/useEditorSession.test.tsx`
- Test: `apps/web/src/features/map-editor/RoadForm.test.tsx`

**Interfaces:**
- Produces: `DrawController.startLine()`, `DrawController.startSelect()`, `DrawController.stop()`, `DrawController.getLineString()`, and editor-session actions `beginCreate`, `beginEdit`, `cancel`, `retrySave`.

- [ ] **Step 1: Write failing tests proving geometry remains in state after a rejected save.**

```tsx
it("keeps the drawn geometry when saving fails", async () => {
  api.createRoad.mockRejectedValue(new Error("Server xatosi"));
  const { result } = renderHook(() => useEditorSession(api));
  act(() => result.current.setGeometry(lineString));
  await act(() => result.current.save(validForm));
  expect(result.current.geometry).toEqual(lineString);
  expect(result.current.error).toBe("Server xatosi");
});
```

- [ ] **Step 2: Run tests and verify failure.**

- [ ] **Step 3: Implement Terra Draw with `TerraDrawLineStringMode` and `TerraDrawSelectMode`.**

```ts
this.draw = new TerraDraw({
  adapter: new TerraDrawMapLibreGLAdapter({ map }),
  modes: [
    new TerraDrawLineStringMode(),
    new TerraDrawSelectMode({
      flags: { linestring: { feature: { draggable: true, coordinates: { draggable: true, deletable: true } } } },
    }),
  ],
});
```

- [ ] **Step 4: Implement the Uzbek road metadata form and client validation.**

- [ ] **Step 5: Wire save, cancel, and retry without clearing the draft on failure.**

- [ ] **Step 6: Run tests, typecheck, build, and commit.**

```bash
npm test -w @koprik-xarita/web
npm run typecheck -w @koprik-xarita/web
npm run build -w @koprik-xarita/web
git add apps/web/src/features/map-editor
git commit -m "feat: draw and save roads"
```

## Task 7: Edit, Publish, Archive, Restore, and Conflict UX

**Files:**
- Modify: `apps/web/src/features/map-editor/useEditorSession.ts`
- Modify: `apps/web/src/features/map-editor/RoadForm.tsx`
- Create: `apps/web/src/components/ConfirmDialog.tsx`
- Create: `apps/web/src/features/map-editor/RoadDetails.tsx`
- Test: `apps/web/src/features/map-editor/road-actions.test.tsx`

**Interfaces:**
- Consumes API mutation functions `updateRoad`, `publishRoad`, `archiveRoad`, `restoreRoad`.
- Produces visible action states and a conflict recovery path that reloads the latest road without silently overwriting server data.

- [ ] **Step 1: Write failing action tests.**

- [ ] **Step 2: Implement edit mode by loading the selected road into Terra Draw select mode.**

- [ ] **Step 3: Add publish validation and buttons based on road status.**

- [ ] **Step 4: Add archive confirmation and restore action.**

- [ ] **Step 5: Handle HTTP 409 by showing “Bu ko‘cha boshqa oynada o‘zgartirilgan” and offering reload.**

- [ ] **Step 6: Run all web tests and commit.**

```bash
npm test -w @koprik-xarita/web
git add apps/web/src
git commit -m "feat: manage road lifecycle"
```

## Task 8: Local Setup, End-to-End Smoke Test, and Documentation

**Files:**
- Create: `README.md`
- Create: `scripts/smoke-test.mjs`
- Create: `apps/api/src/database/migrate.ts`
- Modify: `.env.example`
- Modify: `package.json`

**Interfaces:**
- Produces: repeatable local setup commands and a smoke test that logs in, creates a draft, updates it, publishes it, searches it, archives it, and restores it.

- [ ] **Step 1: Implement a smoke script with explicit assertions for each API response.**

- [ ] **Step 2: Add setup commands.**

```bash
cp .env.example .env
docker compose up -d db
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

- [ ] **Step 3: Document default development credentials and require changing them outside development.**

- [ ] **Step 4: Run complete verification.**

Run:

```bash
npm test
npm run typecheck
npm run build
```

Expected: all packages PASS and both production bundles are created.

- [ ] **Step 5: Run the API with the in-memory development repository when Docker is unavailable, then execute the smoke test.**

Run: `npm run dev:api:memory` followed by `node scripts/smoke-test.mjs`
Expected: `Ko‘prik Xarita smoke test: PASS`.

- [ ] **Step 6: Commit.**

```bash
git add README.md scripts .env.example package.json apps/api/src/database/migrate.ts
git commit -m "docs: add local setup and verification"
```

## Final Verification Checklist

- [ ] `npm test` passes.
- [ ] `npm run typecheck` passes.
- [ ] `npm run build` passes.
- [ ] API smoke test passes against the in-memory repository.
- [ ] Desktop layout shows left editing panel.
- [ ] Mobile layout shows bottom editing panel.
- [ ] Administrator can draw and save a road.
- [ ] Draft geometry survives save failure.
- [ ] Administrator can edit, publish, archive, and restore a road.
- [ ] Viewer receives only published roads.
- [ ] Search finds roads by name.
- [ ] Basemap source is configurable for future PMTiles.
- [ ] Attribution remains accessible.
