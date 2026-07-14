# HydroViz 3D — Conversation Summary

> Project: `c:\Users\sshrestha3\Desktop\Projects\hydroviz`
> Deployed: `https://hydroinformatics.tulane.edu/lab/hydroviz/`
> Server files: `/www/hydroviz/` on `tuhydroinfo1p01`

---

## Project Overview

Interactive 3D flood simulation for **New Orleans** using CesiumJS + Google Photorealistic 3D Tiles + USGS bare-earth elevation data. User clicks a point on the map, USGS returns true ground elevation, user adjusts water level slider, and animated water surface renders at the correct height.

---

## Tech Stack

| Layer | Technology |
|:--|:--|
| 3D Engine | **CesiumJS** (via `vite-plugin-cesium`) |
| 3D Tiles | Google Photorealistic 3D Tiles (Ion asset 2275207) |
| Elevation | **USGS 3DEP EPQS API** (bare-earth, NAVD88/MSL, ~10m resolution) |
| Build | **Vite** |
| Deployment | Nginx with `alias` directive, base path `/lab/hydroviz/` |

---

## Key Architecture Decisions

- **Cesium over Three.js** — Cesium chosen for built-in 3D Tiles support, WGS84 coordinate system, `pickPosition`, `sampleHeightMostDetailed`, and `flyTo`. Three.js would give better visual quality/shaders but requires building all geospatial plumbing from scratch.
- **USGS EPQS for elevation** — Google 3D Tile mesh includes buildings/trees. USGS returns bare-earth (no structures). Essential for accurate flood depth.
- **Geoid offset auto-calibration** — USGS returns NAVD88 (MSL), Cesium renders in WGS84 ellipsoid. Offset is ~-27m for New Orleans. Calibrated on first click by comparing USGS to Cesium ground sample.
- **CORS proxy** — USGS API doesn't send CORS headers. Vite dev proxy at `/api/usgs-elevation/` in dev. Nginx proxy in production.
- **Professional aesthetics** — Dark theme, no gradients, neutral colors. User explicitly requested non-colorful, professional look.

---

## Elevation Pipeline (per click)

```
1. pickPosition → WGS84 ellipsoid height (could be rooftop)
2. sampleHeightMostDetailed × 9 nearby points → minimum = Cesium ground estimate
3. USGS EPQS API → bare-earth NAVD88 (MSL) elevation (no buildings/trees)
4. Geoid offset = cesium_ground - usgs_navd88 (calibrated once, ~-27m for NOLA)
5. Water rendered at: (usgs_navd88 + water_depth) + geoid_offset → ellipsoid height
```

UI displays NAVD88 (MSL) values. Ellipsoid values are internal only.

---

## File Structure

```
src/
├── main.js                          # App entry, boot, click handler, UI wiring
├── viewer.js                        # Cesium viewer init + flyToPreset()
├── tiles.js                         # Google 3D Tiles loader (maximumScreenSpaceError: 4)
├── services/
│   └── ElevationService.js          # USGS EPQS client + geoid calibration
├── water/
│   ├── WaterRenderer.js             # Water surface rendering (Cesium Primitive + Water material)
│   └── FloatingDebrisManager.js     # Floating car models (user-added, uses .glb assets)
├── navigation/
│   └── FirstPersonControls.js       # WASD movement + arrow key look + right-click drag look
├── ui/
│   ├── Controls.js                  # Left panel (location, view, water level, radius, boundary)
│   ├── InfoPanel.js                 # Bottom-right info display
│   └── TokenModal.js                # Cesium Ion token prompt
└── styles/
    └── index.css                    # All styles (dark theme, CSS variables)
```

---

## Data Sources in Use

| Source | Used? | Purpose |
|:--|:--|:--|
| Google 3D Tiles | ✅ | Photorealistic 3D terrain + buildings |
| USGS 3DEP EPQS | ✅ | Bare-earth elevation (NAVD88) |
| FEMA NFHL | ❌ | Not integrated (official flood zones) |
| NOAA NWS | ❌ | Not integrated (real-time flood forecasts) |
| USGS NWIS | ❌ | Not integrated (stream gauge data) |
| NHD | ❌ | Not integrated (river/stream geometry) |

---

## 8 New Orleans Locations (presets in Controls.js)

French Quarter, Lower 9th Ward, Tulane University, Downtown/CBD, Garden District, Mid-City, Lakeview, Gentilly

---

## Navigation Modes

### Orbit Mode (default Cesium)
- Left drag → Rotate, Right drag → Zoom, Scroll → Zoom

### Walk Mode (FirstPersonControls)
- **WASD** — Move forward/back, strafe left/right
- **Q/E** — Up/down
- **Arrow keys** — Look around (heading + pitch) — works without mouse
- **Right-click drag** — Look around (mouse alternative)
- **Shift** — Sprint (3× speed)

---

## Water Rendering Details

- Uses `Cesium.Primitive` with `Cesium.Material.fromType('Water')` 
- Water material: dark teal color (`0.15, 0.25, 0.20, 0.85`), slow animation (0.008), calm amplitude (6.0)
- `aboveGround: false` on `EllipsoidSurfaceAppearance` (required because NOLA is below WGS84 ellipsoid)
- `granularity: 0.0001` for proper earth-curve tessellation
- Circular polygon with configurable radius
- User added `boundary` parameter (circle vs other shapes — check Controls.js for current options)

---

## Floating Debris (User-Added Feature)

- `FloatingDebrisManager.js` spawns 3D car models (`.glb`) within 80m of click origin
- Filters out building rooftops (>1.5m above ground)
- Cars float when water depth > 0.6m, with bobbing + rocking animation
- Submerged by 0.8m below water surface for realism
- Models: `car1.glb`, `car3.glb` (car2.glb temporarily removed — missing from assets folder)
- Scale: 0.02

---

## Deployment

### Vite Config
- `base: '/lab/hydroviz/'`
- Dev proxy: `/api/usgs-elevation/` → `epqs.nationalmap.gov`
- Build: `npx vite build` → outputs to `dist/`
- Copy `dist/*` to `/www/hydroviz/` on server
- Copy `dist/lab/hydroviz/cesium/` to `/www/hydroviz/cesium/` (vite-plugin-cesium nests it)

### Nginx Config (`/etc/nginx/sites/hilab/hydroviz.conf`)
```nginx
location = /lab/hydroviz { return 301 /lab/hydroviz/; }

location ^~ /lab/hydroviz/api/usgs-elevation/ {
    rewrite ^/lab/hydroviz/api/usgs-elevation/(.*)$ /$1 break;
    proxy_pass https://epqs.nationalmap.gov;
    proxy_set_header Host epqs.nationalmap.gov;
    proxy_ssl_server_name on;
}

location ^~ /lab/hydroviz/ {
    alias /www/hydroviz/;
    index index.html;
    try_files $uri $uri/ /lab/hydroviz/index.html;
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot|json)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
```

> **Note:** User reported the nginx config was still not working at last check. The `^~` + `alias` + `try_files` combination may need debugging on the actual server. The reference pattern from `fpm-ai` config was applied but not confirmed working.

---

## User's Recent Changes (since last agent interaction)

Based on file diffs observed:

1. **FloatingDebrisManager.js** — Added floating car debris system (new file)
2. **Controls.js** — Added `currentBoundary` property, changed default radius from 0.008 to 0.004, renamed "Fly To" → "Go To", removed `onFlyTo` from location select change
3. **WaterRenderer.js** — Changed water color to darker teal, slower animation, added `granularity`, `getWaterSurfaceElevation()` returns `Number.NEGATIVE_INFINITY` instead of 0
4. **main.js** — Integrated `FloatingDebrisManager`, added `onBoundaryChange` callback, wired debris updates to water level changes
5. **InfoPanel.js** — Removed "Water Surface" info item
6. **tiles.js** — Changed `maximumScreenSpaceError` from 8 to 4
7. **CSS** — Various formatting/style tweaks (brighter muted text, blue primary buttons, reformatted keyframes)

---

## Known Issues / Open Items

1. **Nginx deployment** — May still need debugging (404s were occurring)
2. **car2.glb missing** — Temporarily removed from debris models array
3. **USGS API in production** — Requires nginx proxy. Falls back gracefully to Cesium ground estimate if unavailable
4. **3D tile quality at street level** — LOD settings commented out (user reverted from aggressive settings). Currently `maximumScreenSpaceError: 4`
5. **Water boundary shapes** — `currentBoundary` added to Controls but implementation in WaterRenderer may need work (was only `circle` before)

---

## Potential Next Steps

- Integrate FEMA flood zone data as overlay
- Add NOAA real-time flood forecast data
- Improve water rendering with depth-based opacity
- Fix/verify production deployment
- Add more debris types (furniture, trash, etc.)
- Multi-point water origin or watershed-based flooding
- Export/screenshot functionality
