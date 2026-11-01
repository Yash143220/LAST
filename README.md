# LAST: Last Active Survival Tag

Real-world, GPS-based multiplayer zombie survival game. Mobile-first web app (React + MapLibre) with an authoritative Node/Socket.IO server and MongoDB.

**Colours:** "Zombie Breath" palette as the base (`#0E231E` background, `#26A62D` / `#85D950` greens, `#D7E5DE` text, `#97B6A7` secondary) plus two accents borrowed from the other palette: coral `#ED6760` (zombies / danger zone) and teal `#88CEC6` (intel, radar, hints). The coral/teal palette alone has no good "safe" colour, so it is used only where the green palette has no red.

## Quick start (development)

Requires Node 20.19+ and a MongoDB (local, Docker, or Atlas).

```bash
npm run install:all
# terminal 1 (API + sockets on :8080). Dev login is on automatically when NODE_ENV != production.
ADMIN_EMAILS=tester@dev.local npm run dev:server
# terminal 2 (web app on :5173, proxied to :8080)
npm run dev:client
```
Open http://localhost:5173 (use your phone on the same Wi-Fi via the printed network URL). Sign in with the **dev login** (callsign `Tester` is the admin when `ADMIN_EMAILS=tester@dev.local`). Host a match, switch on "Allow simulated GPS" in Rules, and you can play alone with the on-screen move pad. Browser location and camera need HTTPS except on `localhost`.

## Production

1. **Google sign-in:** Google Cloud Console → Credentials → *OAuth client ID* (Web). Add your site origin to *Authorised JavaScript origins*. Put the client ID in `GOOGLE_CLIENT_ID`.
2. `cp server/.env.example server/.env` and fill in `MONGODB_URI`, `JWT_SECRET` (`openssl rand -hex 48`), `GOOGLE_CLIENT_ID`, `ADMIN_EMAILS` (your Google email, only these can open `/admin`).
3. Set `client/.env` (`VITE_OPERATOR_NAME`, `VITE_CONTACT_EMAIL`) so the legal pages show who you are.
4. Run behind HTTPS (Caddy, nginx, Render, Fly, Railway...). Needs WebSocket support and `TRUST_PROXY=1`.
   ```bash
   docker compose up -d --build        # app + MongoDB
   # or without Docker:
   npm run install:all && npm run build && NODE_ENV=production npm start
   ```
5. Health check: `GET /healthz`.

The server refuses to start in production without `JWT_SECRET` and `GOOGLE_CLIENT_ID`; the dev login is disabled in production.

## What is in the box

- **Auth & accounts:** Google sign-in verified server-side, httpOnly session cookie, five mandatory consent boxes (Terms, Privacy, location sharing, safety rules, age) stored with version + timestamp and re-asked when the version changes. Profile: callsign, picture upload (resized in-browser) or Google photo, data export (JSON), sign out everywhere, **delete account** (anonymises match history).
- **Host setup:** all rules configurable before start (players, zombies, length, missions needed, hold times, infection range, QR lifetime, hint interval/size, shrink on/off, grace period/penalty, GPS accuracy, signal-loss rule, practice-mode GPS). Play area by **centre + radius (50 m-1.5 km)** or by **drawing a path** (max 1 km from centre, no self-crossing, 5,000 m²-3 km²). Danger zone (outside) is shaded red on the map; the final safe zone is shown for placing extraction. Place-search via Nominatim.
- **Checkpoints:** drag-to-place missions, supply points and extraction. Every checkpoint must be explicitly **approved** by the host; the map warns when a pin sits on a building, road, railway or water (from the rendered map data). "Suggest spots" drafts safe-looking candidates but never approves them. Presets save area + checkpoints (approvals are never carried over). The host must also tick a safety confirmation, which is automatically cleared if the area or any checkpoint changes.
- **Gameplay (server-authoritative):** secret random roles; missions need presence + hold time verified by the server tick; shrinking safe zone (scaled 300/260/220/170/120/70/40 table); periodic fuzzed location hints (never exact coordinates, never user ids); supplies (Shield, Radar, Energy Pack, Antidote) bought with mission credits; **GPS-proximity + one-time QR infection** (15 s, single use, replay-proof, rate-limited, 6-digit manual fallback); extraction in the final window; win conditions computed only on the server; pause/resume that freezes every clock; reconnect restores state; in-memory rooms snapshot to MongoDB and are restored after a restart (restored matches come back paused).
- **Safety:** approved outdoor checkpoints only, "walk, never run" rules, in-game hazard report with optional pause-for-everyone, host emergency pause/end, leave any time, permission explanation + GPS test in the lobby, penalties only with fresh and accurate GPS.
- **Admin console (`/admin`, developer-only):** live stats, live rooms with **spectate map** (exact positions, roles, SIM/GPS-jump flags), pause/resume/terminate, searchable player list with suspend / restore / delete, match history, safety reports queue, audit log of every admin action, broadcast + pinned announcement, maintenance mode (blocks new matches), system health (memory, sockets, DB). Non-admins get a 404 from the admin API.
- **Map:** MapLibre GL JS v6 with free OpenFreeMap vector tiles (OpenStreetMap data, no API key, 3D buildings, tilt toggle). Override the style with `VITE_MAP_STYLE`.
- **Hardening:** helmet CSP/COOP/permissions-policy, same-origin check on writes + SameSite cookies, rate limits (HTTP and per-socket), schema validation (zod), payload limits, one active game per user, capacity cap (`MAX_ROOMS`), signed sessions invalidated on suspend/sign-out-all, TTL indexes for retention (reports 180 d, results/audit 1 y). `npm audit` shows 0 vulnerabilities.

## Tests

```bash
npm test                                    # 15 engine rule tests (no DB needed)
# with the server + MongoDB running:
npm --prefix server run test:e2e            # live REST + Socket.IO end-to-end flow
```
The e2e covers: consent enforcement, host config, lobby secrecy, countdown, role assignment, mission hold, QR infection + replay rejection, pause, reconnect, admin access control, profile edit and account deletion.

## Honest limitations (read before launch)

- **Not verified in my sandbox:** the live MapLibre map (no WebGL in the headless browser I had; build, API calls and all non-map screens were checked), real Google sign-in (needs your client ID), real GPS and camera QR scanning. Do a real-phone dry run outdoors before a public event.
- **GPS is not exact** and cannot be fully protected from spoofing in a browser. The server uses accuracy limits, freshness, jump detection and the QR scan as the real confirmation, and flags SIM/jumpy players to the host and admin.
- **Single server instance.** Rooms live in one process (snapshotted to MongoDB). To scale out, add sticky sessions + the Socket.IO Redis adapter and move room ownership to a shared store.
- **Legal text is a template.** Terms, Privacy and Safety pages are starting points; have a lawyer review them for your jurisdiction (age limit, data-protection rules) before launch.
- No push notifications / installable offline mode (a manifest is included so it can be added to the home screen). Camera scanning requires HTTPS.
- Nominatim place search must respect its usage policy (light, user-triggered use only); for heavy use switch to a geocoder you host or pay for it.
