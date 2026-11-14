# Launch checklist

Before the site goes live, every promise in the original brief and every goal in the design has to be **shown**, not just claimed. This page lists each one, the evidence, and where it stands.

Checked on 14 November 2026, on the code that is on the preview today (commit `843fe0f`) plus the hand-back changes.

## What the words mean

- **Shown**: an automatic test proves it, or a picture shows it. The test or picture is named.
- **To check on the phone**: only a person on a real phone can judge it (how it looks, how smooth it feels). Do it with `phone-test.md`.
- **Waiting for the card redesign**: it depends on the landing card, which is being redesigned. It is checked again once the new card is in.
- **Not yet**: it cannot be done until you say yes to going live.

"Unit test" means a quick automatic check of one part of the code. "Browser test" means an automatic check that opens the real site in a browser, on a 390 x 844 phone-sized screen, with the winds and map answered from saved copies so the results are the same every time.

## The evidence runs

| Run | Result |
| --- | --- |
| Unit tests, on this machine | **754 passed, 0 failed** (81 files) |
| Type check, on this machine | **No errors** |
| GitHub's check on `843fe0f` (run 43572635510) | Type check, 751 unit tests (3 skipped there), 22 wind-pipeline tests: **all passed**, then published to the preview |
| Browser tests used below, on this machine | 41 picked for this page: **39 passed, 2 failed** on the first try. On a second try the launch test passed; "the route is ready within 2 s of Let go" failed again (see B1 and "What is left"). The other browser tests (card, contrast, context loss, wind streaks) were not run for this page |

GitHub's checks do not run the browser tests, so I ran them here.

## The brief: "Done means"

From `docs/reference/01_let_go_of_a_balloon.md`.

| # | Promise | Evidence | Status |
| --- | --- | --- | --- |
| B1 | It works on a phone, and the path draws in under 5 seconds | Browser tests, on a phone-sized screen with the processor slowed 4 times and a "Fast 4G" connection: "something is on screen within 2 s: the sky and the title, then the 3D world" and "the route is ready within 2 s of Let go" (`e2e/perf.spec.ts`). The whole route then plays in about 20 seconds by design (spec 6.4), or draws in place in 2 seconds with reduced motion: "reduced motion: no fly-through; the route is drawn in place over 2 s and held" (`e2e/replay.spec.ts`). | **Shown** for the brief's 5 seconds. The design's tighter 2 seconds for the route: **not shown on this machine** (see "What is left"). Phone: **to check on the phone** |
| B2 | The landing card shows the distance and the place name | Today's card has its tests (`e2e/card.spec.ts`, `tests/ui/card.test.ts`), but the card is being replaced. | **Waiting for the card redesign** |
| B3 | There is a shareable image of the path | The card is the shareable image. Same as B2. | **Waiting for the card redesign** |
| B4 | The credits footer is in place | Browser tests: "credits list every source and "A Still Signal build", and close with Escape" and "the simulation notice and the map credit are on screen" (`e2e/start.spec.ts`), and "the credits list every source and end with "A Still Signal build"" (`e2e/fallback.spec.ts`). | **Shown** |

## The design: goals (spec section 3)

From `docs/superpowers/specs/2026-11-12-let-go-of-a-balloon-design.md`.

| # | Goal | Evidence | Status |
| --- | --- | --- | --- |
| G1 | Works on a phone first | Every browser test runs on a 390 x 844 phone screen. Browser tests: "controls are at least 44 px tall and none sits in the bottom 40 px" and "at 320 px the small print stays inside the gutters with no horizontal overflow" (`e2e/start.spec.ts`). How it feels in the hand: phone test. | **Shown**. Feel: **to check on the phone** |
| G2 | Something useful on screen within about 2 seconds | Browser test: "something is on screen within 2 s: the sky and the title, then the 3D world" (`e2e/perf.spec.ts`), with the slowed processor and 4G. | **Shown** (passed here). On a real phone: **to check on the phone** |
| G3 | The real place is recognisable: coastline, rivers, street pattern, parks, building heights, and hand-made landmarks in featured cities | Pictures: `img/london-launch.png` (Westminster and the Thames from 160 m, at golden hour) and `img/moors-ride.png` (over Holme, on the edge of the Pennine moors). Unit tests: "roads and rivers drape 0.3 m above the drawn ground", "trees: none on the protected-area (park layer) polygon, some in the city parks" (`tests/world/meshjob.test.ts`); "Elizabeth Tower is returned within 1 km of Parliament Square" (`tests/landmarks/registry.test.ts`); "launch views re-aimed at their landmark models" (`tests/ui/cities.test.ts`). | **Shown** (pictures and tests). Your own town: **to check on the phone** |
| G4 | The route comes from real forecast winds | The live site's wind list (`/winds/manifest.json`) holds the US weather service's runs 2026111400, 2026111318, 2026111312 and 2026111306, fetched by GitHub's timer (run 43578826349 at 09:05 UTC today: "Newest run with f096: 2026111400"). Unit tests: `tests/wind/` (for example "newest run 404 falls back to previous run") and `tests/flight/route.test.ts` ("constant 10 m/s westerly wind (u=+10) for 72 h from (0, 0) moves ~2592 km east"). | **Shown** |
| G5 | The flight runs in real time for 72 hours | Browser tests: "a shared link opens the live flight: string line, "Day 1 of 3", ticks at local midnight" and "a link opened after 72 hours shows the balloon landed" (`e2e/live.spec.ts`). Unit tests: "after 72 h it has landed", "release to 72 h, clamped" (`tests/ui/hudmath.test.ts`). | **Shown** |
| G6 | Works anywhere in the world, including small towns with no landmark models (for example Windermere) | Browser test: the town search finds "Windermere, England, United Kingdom" and lets go from it (`e2e/start.spec.ts`, "search input follows the combobox pattern"). Unit tests: towns with no building data get houses ("gap fill: houses in residential land with no buildings", `tests/world/meshjob.test.ts`); the date line ("route crossing 180° stays continuous", `tests/flight/route.test.ts`; "a route over the date line fits as one piece", `tests/fallback/map2d.test.ts`); the poles ("routeGround caches tiles and handles poles", `tests/world/terrain.test.ts`). | **Shown** (tests). Windermere and Auckland on a real phone: **to check on the phone** |
| G7 | Costs £0 to run | The site is plain files on Cloudflare Pages' free plan, built by GitHub's free Actions for public projects. The winds are made in advance, so visitors never call a paid or limited service. The page is only allowed to talk to free, keyless services (its security policy lists OpenFreeMap, Mapterhorn, the Amazon open-data terrain and Open-Meteo's place search), and the browser test "the page runs under its Content-Security-Policy: start, search, Let go and the live flight, with no violation" (`e2e/security.spec.ts`) proves it stays inside that list. | **Shown** |
| G8 | No sign-ups, no ads, no personal data stored anywhere but the visitor's own browser | A search of the site's code finds no sign-in, no ad or analytics code and no cookies. The only things it saves are the last place used and "Your balloons", in the visitor's own browser (`src/ui/start.ts`, `src/flight/store.ts`). Browser tests: "works with storage blocked", "Use my location starts the route at the exact GPS position" and "no request goes to fonts.googleapis.com" (`e2e/start.spec.ts`); the launch test checks the balloon's link is kept after the `#`, which browsers never send to a server, and that the page asks no outside service for anything beyond the map and the winds (`e2e/live.spec.ts`, "Let go from Albert Square"). | **Shown** |

## The design: anti-goals (also spec section 3)

Things that would make it a failure even if it works.

| # | Must not | Evidence | Status |
| --- | --- | --- | --- |
| A1 | Look like a default AI-made site: no candy colours, tilt-shift blur, purple gradients, glow behind text, Inter or Fraunces | Unit tests: "no purple in sky or horizon colours" (`tests/world/palette.test.ts`); "dusk may turn the towns a calm violet-grey (intended), never a candy one" (`tests/world/purple.test.ts`). Browser tests: "orange appears only on Let go" and "no request goes to fonts.googleapis.com; Archivo comes from this site" (`e2e/start.spec.ts`). The design and accessibility pass (Task 23) is merged in `843fe0f`. Pictures: `img/`. | **Shown** (tests). Your eye: **to check on the phone** |
| A2 | Feel like a map with a balloon on it | Pictures: `img/london-launch.png`, `img/moors-ride.png`. This is a judgement. | **To check on the phone** |
| A3 | Stutter on an ordinary phone, or take long to show anything | Browser tests: "the hard caps hold during 20 s of live flight (renderer.info)" (under 600,000 triangles and 250 draw calls) and "?fps=1 shows a frame counter on screen" (`e2e/perf.spec.ts`). The test machine draws in software, so real smoothness can only be read on a phone, with the frame counter. | Caps: **shown**. Time to show something: **shown** (G2). Smoothness: **to check on the phone** |
| A4 | Have any cost that grows with traffic | Same as G7: plain files, no paid map or 3D tile service, winds made in advance. | **Shown** |

## Going live (plan Task 24, step 1)

| # | Step | Evidence | Status |
| --- | --- | --- | --- |
| L1 | The work is copied to `main`, and the live deploy goes green | See `go-live.md`. | **Not yet**: waiting for your yes |
| L2 | The live link opens on a phone, and balloons go from London, Windermere and Auckland (the date line) | `phone-test.md` | **Not yet**: after L1 |

## What is left

1. **The route in under 2 seconds (design section 3, plan Task 22): not shown on this machine.** The browser test "the route is ready within 2 s of Let go" took 3.7 and 3.5 seconds on the first run, then 2.5 and 3.0 seconds on the second. That is on a phone-sized screen with the processor deliberately slowed 4 times, on a shared test machine that was doing 6 or 7 times more work than it has processors. It passed when it was written (Task 22), and it is well inside the brief's 5 seconds every time. I will run it again on a quiet machine before going live. You can also judge it on your phone: after you tap **Let go**, the hand should open within about 2 seconds.
2. **The moment of letting go in London could not be pictured here.** Taking a 1080 x 1920 picture during the launch timed out once, and the one frame caught had a flat grey band across its top half, probably the camera passing a building wall. The automatic launch test does not look at the picture, so it would not notice. It may only be the slow test machine. Check it in step 1 of `phone-test.md`.
3. **The launch test failed once, then passed.** On the first run the browser closed in the middle of "Let go from Albert Square" ("Target page, context or browser has been closed"), on the same overloaded machine. Run again on its own, it passed. I count it as shown, but I will watch it in the final run.
4. **The landing card (B2, B3):** waiting for the card redesign.
5. **The phone checks:** do `phone-test.md` once the site is live.
6. **Going live (L1, L2):** waiting for your yes. See `go-live.md`.
