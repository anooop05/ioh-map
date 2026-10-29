# IOH Campus Guide — IIT Madras

A responsive Innovation Open House campus map prototype built with React, Vite, TypeScript/TSX, Leaflet, React Leaflet and plain CSS. Lab attendance, access settings and event slot changes live in React state for the current browser session only.

## Run locally

```sh
npm install
npm run dev
```

Build the static site with `npm run build` and preview it with `npm run preview`.

## Demo data and map

The sample attendance, maximum capacities, hours, access flags and all lab coordinates in `src/data/labs.ts` are demonstration data. The dataset validates duplicate IDs, coordinate ranges, capacities, visitor counts and access values on startup. Coordinates are approximate placeholders and are not verified building locations or entrances. Replace them with reviewed event locations before publishing. The base map uses OpenStreetMap tiles and displays required attribution. Campus paths and map detail may be incomplete.

Crowd level is calculated from current attendance and capacity: below 60% is green, 60% to below 85% is yellow, and 85% or more is red. Access is modeled separately; closed and restricted labs do not become available just because the crowd is low.

## Directions and admin

The visitor map requests browser geolocation on load, displays the current position, and follows movement updates. Starting directions requests a pedestrian route from Valhalla and displays the returned path, distance, time and instructions. Navigation zooms closer and rotates the flat Leaflet map in the direction of travel when device heading is available, with the route direction as a fallback. This provides a heading-up view but no 3D camera tilt. Route availability depends on the connection and the public demo service's fair-use limits. The demo service returned routes for the sample campus coordinates during development, but the sample lab coordinates are illustrative and do not verify building entrances or every internal path. Replace them with checked event locations before relying on directions.

Admin is a prototype control, not authentication. Edits are local to the current page session and are not saved across devices or synchronized with an event system. The event-slot selector is demonstration state and does not provide slot-specific records.

Open the admin view directly at `/admin`; the visitor map has no admin link. The hosting service must rewrite app routes such as `/admin` to `index.html` so direct loads and refreshes work in production. Browser back/forward navigation is supported.
