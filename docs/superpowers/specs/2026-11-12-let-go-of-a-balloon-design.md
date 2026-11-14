# Let Go of a Balloon: design

Status: approved by SK. Written 12 November 2026, updated after the builder check and the design, engineering and physics reviews.
Owner: SK (Still Signal). SK is not technical: when he has to do something himself, explain it click by click, in plain British English.

Read these first, in this order:

1. `docs/reference/00_shared_rules.md` (rules for all five weekend builds)
2. `docs/reference/01_let_go_of_a_balloon.md` (the original brief; this document replaces it where they differ)
3. This document
4. `docs/reference/launch-cities.csv` (the 120 launch cities and their landmarks)
5. `docs/reference/style-prototype/` (the working 3D style frame SK approved, with screenshots)

---

## 1. What this is, in one paragraph

A single web page. You pick a town anywhere in the world, or use your location, or pick one of 120 featured cities. You press Let go. A person standing in the street opens their hand and a red party balloon floats up past the rooftops. From then on it drifts on the real forecast winds for three days, live and in real time, over a miniature version of the real world drawn in one consistent game-like style. You can come back tomorrow and see where it has got to. A "Show me the whole trip" button plays the whole three-day forecast route in about 20 seconds and ends on a postcard saying where it is expected to land. The page is made to be screen-recorded and posted on LinkedIn and X.

## 2. Why, and what success looks like

- It is a Still Signal builder post: built with AI, said openly, shared on LinkedIn and X. Most clicks come from the LinkedIn phone app.
- Success is people trying their own town and sharing where their balloon went. The post needs one striking screenshot, a 10 to 20 second silent recording that reads instantly, and a landing card people want to share.
- The emotional core is the act of letting go of a balloon and following it. Everything should serve that feeling.

## 3. Goals, non-goals, anti-goals

Goals
- Works on a phone first. Something useful on screen within about 2 seconds.
- The real place is recognisable: coastline, rivers, street pattern, parks, building heights, and hand-made landmarks in featured cities.
- The balloon's route comes from real forecast winds, and the flight runs in real time for 72 hours.
- Works anywhere in the world, including small towns with no landmark models (for example Windermere).
- Costs £0 to run, with no sign-ups, no ads, no personal data stored anywhere but the visitor's own browser.

Non-goals for this version
- Seeing everyone else's balloons (needs a database; maybe later).
- Choosing the balloon's height (maybe later; the default is about 1.5 km).
- Photo-real buildings or facades.
- Real clouds or rain from forecasts (a possible extra later).

Anti-goals (would make it a failure even if it technically works)
- Looking like a default AI-made site or a generic "cute tiny town". No candy colours, no tilt-shift blur, no purple gradients, no glow behind text, no Inter or Fraunces.
- Feeling like a map with a balloon on it. It must feel like a camera hanging from your balloon over a living miniature world.
- Stuttering on an ordinary phone, or taking long to show anything.
- Any cost that can grow with traffic (no paid map or 3D tile services).

## 4. Constraints

From the shared rules (`00_shared_rules.md`), all binding:
- Free public data only. Non-commercial. No logins, no personal data.
- Credit every data source in a small footer, with links, plus "A Still Signal build".
- Mobile first. Fast. British spelling. Short, plain words on screen.
- Hosting: GitHub plus Cloudflare Pages, both free.

About the Wiz Digital standards file (`CLAUDE.md` with React, Node, Express, Azure SQL, MVC, Docker): it does not apply to this project. SK has approved a static site with no backend, no database and no Docker, because a server and Azure SQL would cost money and break the £0 rule. SK asked that the README is not changed to record this; the decision is recorded here instead.

## 5. Approaches considered

### 5.1 Where the winds come from

1. Live from Open-Meteo on each visit (the original brief). Free for non-commercial use under 10,000 calls a day, but asking for many places in one request counts as one call per place, and there are also hourly and per-minute limits. The limits appear to be per internet connection, and mobile networks put many phones behind one address, so a busy day could stop balloons flying. A route that is fetched fresh on every visit would also change between visits.
2. A Cloudflare Worker that fetches from Open-Meteo and caches by place and hour. All visitors then share one address, so the daily limit is hit sooner.
3. Chosen: prepare the winds in advance from NOAA's GFS forecast (US government open data, free to use, no limits), four times a day, using a free scheduled GitHub Action, and ship them as static files on Cloudflare Pages. Every visitor gets an answer instantly, there is no shared limit, and the whole world is covered.

### 5.2 How the world is drawn

1. A satellite map engine (MapLibre with free imagery). Rejected by SK as bland: it reads as a map, not a world.
2. Photo-real 3D city tiles (Google). Only about 1,000 free requests a month, billing must be switched on, heavy on phones. Breaks the £0 rule.
3. Chosen: a custom three.js scene that draws real map data (terrain, coast, water, land use, roads, buildings) in a stylised, game-like look, plus hand-made landmark models for featured cities.

### 5.3 Which look

Three styles were prototyped (Sculpted terraces like Godus, Low-poly like Polytopia, Toy town like Pocket City) and judged by a panel of three agents (virality, design quality, real-data feasibility) over two rounds. All three converged on a hybrid SK has approved, called **Contour** (section 7).

---

## 6. The experience, step by step

### 6.1 Start screen
- Let go works at once, with no search needed. It starts from the last place used, or from Parliament Square in London the first time. Above the button, "From London" opens the search. It is drawn as a control, not as underlined text: a chip with a map pin and a chevron, a hairline border and 8 px corners (owner's decision, 14 November 2026 (panel review)).
- Top to bottom:
  - title;
  - one-line explainer;
  - the person and the balloon in the live scene (middle third of the screen, nothing on top of them);
  - "From London";
  - the Let go button;
  - "Use my location" as a secondary button beside Let go: outlined, with a locate mark, never filled (owner's decision, 14 November 2026 (panel review)). Let go stays the one solid, orange, dominant action;
  - featured cities as one sideways-scrolling row of six chips (launch batch first), each a hairline box at least 44 px tall. The row reads as a scroller: it snaps, and a 48 px edge fade covers the chip running off the edge, with room to scroll the last chip fully clear of it, so nothing looks cut off by accident (owner's decision, 14 November 2026 (panel review));
  - "Your balloons", only if the visitor has any (below);
  - one line of small print: "A simulation" and the map credit (see 7.1), with the full notice and every credit in the About sheet (owner's decision, 14 November 2026 (panel review)).
- The top right holds "About". It opens the About sheet: the simulation notice in full (7.4), what happens next ("It flies on for three days. Come back any time to see where it is."), and the credits, ending "A Still Signal build". The flight HUD's small print has its own "About", which opens the same sheet (owner's decision, 14 November 2026 (panel review)).
- Town search: Open-Meteo's free place-name search, called from the visitor's browser. Each suggestion shows the place name, region and country so places can be told apart, for example "Windermere, England, United Kingdom". It uses the accessible combobox pattern.
- Search ranking (owner's decision, 14 November 2026 (panel review)): results in the visitor's own country come first, then bigger places before smaller ones (Open-Meteo's order breaks ties). The hints are the region of the browser's languages (`navigator.languages`, "en-GB" is Great Britain) and its time zone, compared with each result's country code and time zone. They are read and used in the browser only; nothing new is sent to any server beyond the existing place-name query. A British visitor gets Windermere in England first; one in Florida gets the Florida one.
- Featured cities come from `launch-cities.csv`. A featured city starts at its named launch spot. Any other place starts at the point the search returns, moved to the nearest open public space if it lands inside a building. "Use my location" starts exactly where the visitor is, from their phone's GPS.
- Arriving from a shared link opens that balloon's live flight, not the start screen, with "Let go of your own" as the second action.
- The 3D world is live behind the start screen at the real time of day for the start place. The page never shows a blank screen or a spinner (see 7.2).

### 6.2 Let go (the launch)
- Street level. A simple stylised person (no face, no identifying detail, neutral clothing) stands holding the balloon's string. The person opens their hand, looks up and maybe raises an arm. The balloon squashes slightly as it pulls free, then rises past windows, lamp posts and rooftops.
- The balloon is a real party balloon at real size (about 30 cm). Because the camera stays a few metres from it, it stays large on screen while the city drops away. In wide shots where the camera is far away, it may be enlarged gently so it never vanishes; it must never look as big as a building at street level.
- Height and climb (SK's decision: "storybook height when launching, true height after about 5 minutes; the design needs to be good, but the physics also needs to be tight"):
  - The balloon climbs at a steady, realistic rate of about 1.5 m/s (real party balloons climb at roughly 1.5 to 2.5 m/s). That puts it at roughly 400 to 500 m above the ground after about 5 minutes, which is the "storybook" height where streets, roofs and landmarks read clearly, and at its cruising height after roughly 15 to 20 minutes.
  - It then floats on a pressure level for the rest of the 72 hours: 850 hPa (about 1.5 km), or a higher level (700, 600 or 500 hPa) where the ground is high, always at least 600 m above the ground. A real latex balloon would keep climbing and pop at around 8 km within a couple of hours; the notice on screen says so plainly (7.4).
  - The slow climb is the physics, not a camera trick: the first few minutes look storybook because the balloon really is still low. The camera stays close during this phase.
  - The route uses the real wind at the balloon's actual height at every step (see section 11), so the low early drift and the higher cruise both come from real data.
- In featured cities the landmark is in view during the launch (Big Ben behind the person in London, the Eiffel Tower in Paris).
- The route knows nothing of buildings. A balloon that meets a facade slides up it and over the roof, as a real one would (ruling R57b): the drawn balloon is eased up ahead of the wall, held against it while it rises, and carries on once clear. This is a small visual nudge to where it is drawn; the route's winds, timing and the HUD's height are unchanged.

### 6.3 The live flight (72 hours, real time, at true height after the climb)
- The route is worked out once, at the moment of release, from the latest wind data, and never changes after that.
- The balloon's position at any moment is the route at (now minus release time). Opening the page tomorrow shows it further along the same route.
- While someone watches, the camera is fully directed, like a film (section 8). There is no free drag-and-spin camera.
- A live facts line changes every few seconds. For the visitor's own balloon the first fact says what happens next: "It flies on for three days. Come back any time to see where it is." It then rotates out (owner's decision, 14 November 2026 (panel review)). Examples: current speed and direction of the wind at 1.5 km; "At 31 km/h it would cross Leeds in about 23 minutes"; distance from home so far; what it is over now ("Over the North Sea", "Over the Lake District"); local time at the balloon; time until sunrise or sunset there; how long until it is expected to land. Place names come from the map data under the balloon.
- A small header shows the local time at the balloon, its height, speed and what it is over, with a thin progress line across the 72 hours (the balloon's string as the signature UI detail).
- Place names people can place (owner's decision, 14 November 2026 (panel review)): the landing line always names a town's country ("Expected to land near Strzelce Krajeńskie, Poland", "Landed near Bergen, Norway"); "Over ..." and the town in the crossing fact name the country when it is not the start's ("Over Wijhe, Netherlands", "At this speed it would cross Rijssen, Netherlands, in about 8 minutes"). The start's country comes from the gazetteer. Generic names stay lower case and alone (R56). The landing card's copy is its own and unchanged.
- "Add to calendar" (owner's decision, 14 November 2026 (panel review)) sits on the day line, beside Pause, while the balloon is up (never once it has landed, nor in the replay). It saves an .ics file (text/calendar, which iOS Safari opens as "Add to Calendar"): one event at the expected landing, 72 hours after release, in UTC (DTSTART and DTEND 15 minutes apart), titled "My balloon from London lands" ("A balloon from ..." for someone else's), with the balloon's own link in the description and URL, and a reminder 15 minutes before. Text is escaped and lines folded at 75 octets (RFC 5545).

### 6.4 "Show me the whole trip"
- Plays the full 72-hour forecast route in about 20 seconds: a wide, high camera follows the route, a trail draws behind the balloon, night and day sweep across the land as the days pass, and large place names appear as it crosses them.
- Clearly labelled as the forecast route, with the expected landing place and time.
- Ends on the landing card. "Back to live" returns to the live view.

### 6.5 The landing card (the shareable thing)
- A 4:5 postcard image (1080 x 1350), made in the browser.
- Top 60%: a high, angled golden-hour view that shows both ends of the route, with a 6 px off-white trail and the balloon at the landing point.
- Bottom 40%: the scene fades into ink, so there is no box behind the text. Text, top to bottom:
  - kicker, 32 px, secondary text colour: "Expected to land near" (or "Landed near")
  - headline, 120 px condensed bold, at most two lines (shrink to 88 px if needed): "Manchester to Bergen", with "to" at regular weight
  - three stats, values 56 px and labels 26 px: distance, time aloft, top speed
  - date and release time
  - the site address
  - credits and "A Still Signal build", 22 px
- A landing at sea is the shareable joke, not a failure: "Expected to come down in the North Sea".
- Share on phones uses the system share sheet with the image file and the pre-filled text "My balloon from Manchester is expected to land near Bergen." On desktop, the card downloads. There is also a "Copy link" button that opens this exact balloon.
- In-app browsers (LinkedIn, X): sharing files and downloads are unreliable there. Detect them and show the card full screen as an image with "Press and hold to save", plus "Open in your browser".
- After 72 hours the live view shows the balloon landed, and the card says "Landed near ..." instead of "Expected to land near ...".
- The site has a static link preview for feeds: a 1200 x 627 golden-hour image, a title and a description (Open Graph and X card tags).

### 6.6 Coming back and sharing a link
- Each balloon gets a link that encodes everything needed to show it again: start point and place name, release time, and the route itself (72 hourly points, quantised and compressed into the address). No server or database. The link works on any device and shows the same route.
- The visitor's own balloons are also remembered in their browser (local storage, at most 20) and listed on the start screen ("Your balloons"). Storage may be unavailable; everything must still work without it.
- "Your balloons" is a short list of rows, the main reason to come back (owner's decision, 14 November 2026 (panel review)). Each row is one tap target at least 44 px tall: the start place, the time aloft ("25 min aloft", "14 h aloft") and, under them, where it is now ("Over the North Sea", "Near Dijon, France", "Landed near Strzelce Krajeńskie, Poland", "Came down in the North Sea"), worked out in the browser from the saved hourly points and the gazetteer. The newest three show on a phone (one on a screen under 760 px tall, such as a phone inside an in-app browser, so the person and the balloon keep the middle third), with "Show all 7" on the label's line.
- "Use my location" uses the exact GPS position, with no rounding or moving (SK's decision). Nothing is sent to any server; the start point only leaves the phone if the visitor chooses to share their link or card.

### 6.7 Edge cases to handle
- Long stretches over open sea, desert or farmland: the world must still look alive (faceted sea with glints, land-use colour, fields, the odd ship or village, cloud shadows).
- Routes that cross the date line, go near the poles, or leave land for days.
- High ground: heights are measured above the ground, and the balloon never goes into a hill. Where the land rises (Mexico City at about 2.2 km, the Alps, the Andes), the balloon keeps its clearance above the terrain and the wind is read at that true altitude from the higher pressure levels. It always flies the full 72 hours; the landing is wherever it is at 72 hours (which may be "in the North Sea").
- Places with little or no building data: fill built-up areas with generic houses in the same style, at a believable density.
- Launches at night or in winter darkness: the scene must still read (lit windows, street lamps, a faint rim of light on the balloon).
- Weather data late or missing: fall back to the previous run; if a route cannot be computed, say so plainly and offer to try again.
- No WebGL or a very weak phone: show a simple 2D fallback of the route and the landing card, with the note "Showing the map view on this device." where the view switch would be (owner's decision, 14 November 2026 (panel review): said neutrally, never "your phone can't").
- Reduced motion setting: calmer camera, no fast replays unless asked.
- Location permission refused: fall back to search, no nagging.
- Say clearly, on screen, that it is a simulation using forecast winds, not a real balloon.

---

## 7. The look: Contour

Agreed by SK after the panel. The prototype in `docs/reference/style-prototype/` shows the direction (open `index.html`, pick "Contour", "Golden" light, "Ride" camera). The prototype's ground is made up; the real build draws it from real data.

- **Ground:** faceted low-poly, flat-shaded, in a calm sage, chalk and clay palette (approximate land colours `#e6d6a2` sand, `#b9cd86` to `#76a063` greens, `#d4a982` clay for steep faces). Land-use areas each get their own tone: farmland patchwork, parkland, scrub, moor, rock, sand.
- **Terraces:** stepped contour terraces only where the real land is steep. Use a fixed step height (about 10 m in real terms), never a step scaled to the local height range. Flat cities stay smooth and are recognised by coast, rivers, roads and land use.
- **Buildings:** real footprints and heights, extruded, in chalk tones (`#f4efe5`, `#ebe3d4`). Low buildings get muted pitched roofs (clay `#d9bfa4`, `#c9ad92`, slate `#9fa6aa`). No red or candy-coloured roofs: the balloon must be the only saturated thing. Regional character through palette and roof style: Paris cream stone with grey zinc roofs, London brick and slate, Barcelona ochre, New York brownstone and glass, and so on. Windows read as a subtle pattern by day and light up at dusk.
- **Trees:** simple faceted cones, placed only where the map shows woods, parks and tree rows, never sprinkled at random.
- **Water:** faceted sea with occasional glinting facets; a deep blue edge (`#2b7fb0`) at the coast so coastlines read; shallows paler (`#8fd3cf`). Rivers and lakes from map data.
- **Sky and light:** the sun and moon follow the real position for the balloon's place and time. Dawn, day, golden hour, dusk and night each have a defined palette. At night: ink-blue sky, stars, warm windows and street lamps, city glow where roads and buildings are densest.
- **Distance:** the land runs to the horizon and fades into haze in the sky colour. No floating island, no edges.
- **Wind streaks** (owner's decision, 14 November 2026): once the balloon is clearly up (from about 300 m above the ground, never in the launch's crane shot), thin, pale, off-white streaks fade in over a few seconds, all slanted along the wind and flowing with it, like rain blown sideways over the whole view (on any screen shape, portrait or landscape), varied in length and brightness and fading at both ends, with distance and into the haze. They live in world space round the balloon's height and are carried by the real wind at the balloon; since the balloon rides that wind (in its own frame the air is still), they flow past it at 5 m/s plus twice the wind's speed (three times the wind over the ground, plus 5 m/s), so they visibly flow in a light wind and faster in a strong one; in a calm they drift slowly the way the wind last blew, never stopping dead. Pause holds them still, still shown. More visible at night, subtle by day; never over the balloon (one in front of it fades out), and the land, the lights and the text read through them. They show in Film (its ride shots included), Above and Side-on, fade out below that height and in the last minutes before landing, and are left out of the whole-trip replay. With reduced motion they are off, and on a software renderer (a browser drawing WebGL without a GPU), where they would cost frames for nothing. One draw call, a few thousand vertices, moved on the GPU.
- **Balloon:** smooth, glossy, bright orange-red (`#ff5a12`), the one bright element. Physical: it squashes and stretches, leans into the wind, wobbles, slowly spins, and its string swings (a simple rope simulation).
- **Signature detail:** the balloon's shadow stepping down the terraces as it drifts, visible in daylight.
- **Hero shot for the post:** golden hour.
- **Banned:** tilt-shift blur, candy colours, glow or drop shadow behind text, hard dark boxes behind text, purple gradients, Inter, Fraunces, emoji in the interface.

Interface chrome: quiet. Off-white text over soft gradient shading at the top and bottom of the screen (no boxes), condensed bold numerals for the clock and figures, one orange accent used only where it means something (Let go, the progress line). Use the impeccable and unslop skills for every interface pass (section 12).

### 7.1 Interface chrome, exact

- **Type:** Archivo, self-hosted as a subset (no Google Fonts request: it slows the first paint and sends visitors' addresses to Google). Everything in sentence case.

  | Text | Size | Width axis | Weight | Other |
  | --- | --- | --- | --- | --- |
  | Clock | 44 px | 62 | 700 | tabular figures |
  | Stat values | 28 px | 62 | 650 | |
  | Labels | 13 px | | 500 | |
  | Fact line | 16 px | | 450 | line height 1.35 |
  | Buttons | 15 px | | 600 | |
  | Footer | 11 px | | | |

- **Shading behind text:**
  - Bottom gradient: 300 px tall, ink `rgba(10,14,28)` fading from 0.6 to 0.
  - Top gradient: 170 px tall, from 0.5.
  - About once a second, measure how bright the scene is behind the text, and darken both gradients by up to 0.15 more when it is bright.
  - Text must reach 4.5:1 contrast over noon, snow and sand scenes.
  - Over the live world in flight the bottom gradient starts from 0.68, not 0.6 (still up to 0.15 more when bright), and the fact line is weight 500 and swaps in 160 ms, so it never sits half-faded: busy, mid-bright ground such as farmland measures as only middling yet thin text over it needed the help (owner's decision, 14 November 2026 (panel review)).
- **Layout (phones):**
  - Design for a visible area of about 390 x 660 inside in-app browsers. Use `100dvh` and safe-area padding, and keep the bottom 40 px free of anything important.
  - Top left: the clock, with "Over the Lake District" under it. There is no time-of-day word; the light shows it.
  - Bottom, in order: the fact line, the string line (with the day line, "Add to calendar" and Pause under it), the view switch, the main action, the one line of small print.
- **Small print (owner's decision, 14 November 2026 (panel review)):** one line at 11 px wherever the map shows: "A simulation" on the left (with "About" in the flight HUD), and the map credit "© OpenStreetMap · OpenMapTiles · Mapterhorn" on the right, each source a 24 px link. OpenFreeMap and every other source are credited in full in the About sheet. The disclaimer itself moved into the About sheet; "A simulation" stays visible for honesty.
- **The string line (signature detail):**
  - A 1.5 px off-white track at 35% opacity, the full width.
  - An orange fill from release to now, ending in a 6 px knot.
  - Small ticks at each local midnight, and a hollow ring at 72 hours.
  - Under it: "Day 1 of 3 · 14 h aloft".
- **View switch:** text only, "Film · Above · Side-on" (Ride dropped as a tab, owner's decision, 14 November 2026 (panel review): Film still cuts to its ride shots as it cycles, and a page or link that asks for "ride" shows Film chosen). The selected view is off-white with a 2 px underline; the others are at 66% opacity (60% at first; 66% keeps them at 4.5:1 over a bright noon scene under the full shading, ruling R54). No pills, boxes or background blur.
- **Buttons:**
  - Let go: orange `#ff5a12` with a white label at least 19 px bold, so it counts as large text for contrast.
  - Start-screen controls that choose a place are drawn as controls (owner's decision, 14 November 2026 (panel review)): the place chip, "Use my location" (outlined, 1.5 px, 52 px tall beside Let go) and the city chips (1 px hairline, 8 px corners, a faint ink tint, no blur). The chosen city's chip has a full-strength border.
  - During the flight the main action is "Show me the whole trip": off-white fill with ink text.
  - Orange is used only for Let go and the string line.
  - Touch targets are at least 44 px.
- **Focus ring:** 2 px off-white with a 2 px ink outer ring.
- **Favicon:** a flat orange circle with a string. No emoji.
- **Banned AI tells:** glassy blurred buttons, rows of equal pills, spinners, skeletons over the scene, toasts, confetti or any celebration on landing, centred hero stacks over the balloon.
- **Template test:** if the string line, the condensed numerals and the place-specific facts were removed, would the screen fit any other app? If yes, push those three harder.

### 7.2 Waiting and loading

- 0 to 2 s: the golden-hour (or current) sky gradient and the title paint first. Map tiles fade in from the haze outwards, never as grey squares.
- If the route is not ready when the hand would open (at 1.2 s), the person keeps holding the balloon with an idle sway for up to 6 s, then the wind error appears. If the winds have arrived but the route is still being worked out, the person keeps holding for up to 20 s.
- Search shows "Searching" inline in the dropdown. While location is being found, the location link reads "Finding you".

### 7.3 Accessibility

- A visible Pause control stops the camera movement and the rotating facts (WCAG 2.2.2).
- The fact line is `aria-live="off"`. A separate polite status area announces only the launch, a change of country, and the landing.
- The 3D canvas has `role="img"` and a label that updates during the flight, for example "Your balloon is over the North Sea, 412 km from Manchester".
- Reduced motion:
  - The launch has no crane: a still frame on a long lens of the person, the landmark behind them and the rising balloon (big enough to read, about 4% of the frame's height), then a cut to the settled view as the balloon leaves the frame.
  - Ride with fixed framing and half the wobble.
  - The replay becomes the route drawing in place over 2 s.

### 7.4 Copy (British English, no exclamation marks)

**Main screen**

- Title: Let go of a balloon
- Explainer: Pick a place, let go, and follow it on today's real winds for three days
- Search placeholder: Search for a town
- Simulation notice: A simulation using forecast winds, not a real balloon. Real party balloons climb higher and pop; this one floats at about 1.5 km so you can see the ground.

**Buttons**

- Let go
- Use my location
- Show me the whole trip
- Back to live
- Share card
- Save image
- Copy link (then "Link copied")
- Let go of another
- Let go of your own
- About, Add to calendar, Show all 7 (owner's decision, 14 November 2026 (panel review))

**Replay label:** Forecast route, 72 hours in 20 seconds

**Fact line templates**

- Wind at 1.5 km: 31 km/h from the south-west
- At this speed it would cross Leeds in about 23 minutes
- 412 km from Manchester so far · Expected to land in 2 days 6 hours

**Landed:** Landed near Bergen on Sun 15 Nov

**Errors**

- We can't get today's winds right now. Try again in a few minutes. [Try again]
- No places found. Try a nearby town.
- Location is off. Search for your town instead.
- This balloon link is broken. [Let go of a new one]
- Showing the map view on this device. (owner's decision, 14 November 2026 (panel review); it replaced "Your phone can't show the 3D world, so here is the route on a map.")

## 8. The camera

Fully directed, like a film. People can choose a view with buttons, but cannot drag or spin.

- **Launch:** low at street level beside the person, the landmark behind them; at the release a crane shot pulls back and rises as the balloon climbs out of the street, then pushes back in to Ride once it has cleared the rooftops.
- **Ride:** as if a camera were tied to the balloon's string: just below and behind the balloon, which sits large at the top of the frame, looking forward and down at the land ahead. This is the core "camera on my balloon" view.
- **Circling:** slow orbit from above and to one side, looking down at the balloon and the land.
- **Side-on:** level with the balloon, land or sea passing below, horizon in view.
- **Straight down:** looking down past the balloon at the ground.
- In live mode the camera moves between these by itself with smooth, slow transitions (no hard cuts). Film mode changes shot on events: crossing a coast, sunset or sunrise, entering a city, or a landmark coming into view. The fixed rotation of 40 s Ride, 30 s Circling, 30 s Side-on and 20 s Straight down is only the fallback when nothing happens. The view buttons are Film (automatic), Above and Side-on; Ride is no longer a button of its own but stays one of Film's shots (owner's decision, 14 November 2026 (panel review)).
- In Ride, the balloon fills between 18% and 35% of the screen height, never cropped or oversized.
- Launch timing:
  - On tap, the button scales to 0.97 and all chrome fades out over 300 ms, the clock and the top shading too, giving a clean frame for recordings; the clock comes back with the HUD when the launch settles (owner's decision, 14 November 2026 (panel review): the lone clock read as clutter).
  - At 1.2 s the hand opens and the balloon squashes for 120 ms.
  - Then the crane shot (rulings R51, R57): in one eased move with no cuts the camera opens with the hand and rises with the balloon, close to it (the balloon about 6-9% of the frame's height), a little below it and to the side, the featured landmark beyond it where there is one. Facades and windows slide down the frame and the sky opens above; the camera eases back a little as it rises. It keeps the balloon in sight every frame, going round or over a building in the way, and never faces a wall close by.
  - Once the balloon has cleared the rooftops round it (within about 30 m, with a margin), and no wall that would hem Ride in stands over its path in the next few seconds, not at a fixed time, the camera pushes in on the balloon over the roofs and Ride settles; the HUD fades in over 600 ms when Ride settles, no sooner than about 12 s and no later than about 40 s. If the 40 s comes first (a tall landmark beside the balloon's path), the last crane frame is the balloon against the sky with the landmark beside it, and the camera eases into Ride from there. With reduced motion there is no crane: a still frame (the person, the balloon and the landmark) holds until the balloon leaves it, then cuts to Ride, and the 12 s floor does not apply (ruling R58).
  - Film's rotation starts after that. While Ride would film a wall (the balloon below the tops of buildings within a few metres of it or just ahead, as down a narrow street in a link opened in the first minutes), Film circles instead of riding.
- Replay timing:
  - 2 s climb to the wide view.
  - 15 s of travel with eased speed.
  - 2 s descent to the landing.
  - Hold for 1 s, then the card.
  - At most five place names, the biggest ones crossed, each on screen for 1.6 s.
- One easing curve for the interface, `cubic-bezier(0.22,1,0.36,1)`. No overshoot, and no orbit at constant speed.
- The camera must never go inside terrain, buildings or clouds.

## 9. Where the world comes from (all free)

| Layer | Source | Notes |
| --- | --- | --- |
| Hills and terrain | Mapterhorn terrain, published as PMTiles archives (Terrarium encoding) | Global 30 m Copernicus data up to zoom 12, finer regional archives in parts of Europe; read with the pmtiles library and stretched beyond zoom 12. Fallback: AWS Terrain Tiles. Credit Mapterhorn and Copernicus. |
| Coast, water, land use, parks, roads, place names, buildings | OpenFreeMap vector tiles (OpenMapTiles schema) | No keys, no limits. Building layer has footprints with `render_height` and `render_min_height`. Credit OpenStreetMap contributors and OpenMapTiles. |
| Building gaps (optional) | Overture Maps buildings (OSM plus Microsoft, Google and Esri footprints) | Only if their published tiles can be read from a phone without a server; otherwise fill gaps with generic houses. Credit as Overture requires. |
| Winds | NOAA GFS, prepared four times a day | Public domain. Credit "NOAA GFS". |
| Place search | Open-Meteo geocoding | Free for non-commercial use, CC BY 4.0. Credit "Place search: Open-Meteo.com (GeoNames, CC BY 4.0)". The exact credit lines for every source are in the plan's Global Constraints. |
| Place names along the route and at the landing | GeoNames towns (CC BY 4.0) and Natural Earth sea and region names (public domain), prepared as small static files | Open-Meteo cannot look up a name from a position, and map labels only exist where tiles are loaded. Credit GeoNames. |
| Landmarks | Hand-made models, our own | See section 10. |

Recognition comes from, in order: coastline and rivers, street pattern, parks and land-use colour, tall buildings at real heights, and landmarks.

## 10. Featured cities and landmarks

- `launch-cities.csv` lists 120 cities across 20 countries plus city-states and standout cities, each with a launch spot, landmarks to model, an animated touch, coordinates and notes. The live copy SK edits is the "Launch cities" sheet; the CSV is a snapshot of it.
- Tier 1 is 55 cities (including every UK and Irish city on the list); Tier 2 is 65 cities. The "Batch" column sets the order (SK's decision): the site goes live with the core experience working everywhere plus the **launch batch** of 24 cities (every UK and Irish city, plus Paris, New York, Mumbai, Dubai, Tokyo, Sydney, Barcelona, Singapore, Rio de Janeiro and Cappadocia). The rest of Tier 1 follows in weekly batches, which also gives SK follow-up posts; Tier 2 comes after that. Until a city's landmarks exist, it still works with real buildings and streets.
- Launch spot coordinates are approximate. Before modelling, confirm each against OpenStreetMap and move it onto an open public space (a square, park or promenade).
- Each landmark is a small model in the Contour style that replaces the plain extruded block at that spot, with an optional simple animation (a clock face lighting at dusk, a wheel turning, a fountain). Models load only when the balloon is near them.
- SK signs off each landmark that has a rights note before it goes live. Rows with a rights note must be checked before modelling (for example: no Eiffel Tower night light show, no Hollywood Sign, care with trademarked buildings such as the Burj Khalifa, and recent buildings in countries with limited freedom of panorama). These notes are flags, not legal advice. Mecca and Medina are left out; mainland China is low priority.

## 11. Winds and the route

- A scheduled GitHub Action (free on a public repository, which SK has approved) checks every hour (two timers half an hour apart, since GitHub often runs them late or skips them) and builds new wind files whenever a new GFS forecast is complete (four forecasts a day). It downloads only the wind fields needed, for the next 120 hours, every 3 hours, and turns them into small static files published with the site on Cloudflare Pages.
- Wind levels needed from day one: the east-west and north-south wind and the height of each level on 1000, 975, 950, 925, 900, 850 hPa for the climb (forecast hours 3 to 24, fine 0.25° grid) and 850, 800, 750, 700, 600, 500 hPa for the cruise (hours 0 to 120, 1° grid). A run is used while it is under 48 hours old and its winds reach the landing, 72 hours after release; the newest such run is preferred (ruling R59). The fine climb winds stay at hours 3 to 24: a release from a run 24 to 48 hours old (only when the refresh has been failing) climbs on the cruise winds, which are coarser near the ground; extending the climb hours would double every climb file for every visitor. The update job checks every hour for a new run, and fails loudly (GitHub emails the owner) when the newest run on the live site is over 18 hours old. Its timer runs build the site without the type check of the tests, so a test-only error cannot stop the winds.
- Physics: during the climb, the balloon's altitude picks the wind by interpolating between the two pressure levels around it, and in space and time. At cruise it follows its pressure level (section 6.2). Ground height for the route comes from coarse terrain (the highest point near each step), so the route is quick to compute.
- Files are split so a phone only downloads the parts along its route (for example by region and time window). A typical release should need well under 1 MB.
- The route is computed in the browser at release: step through time (for example every 10 minutes), read the wind at the balloon's position and time (interpolated in space and time), move the balloon, repeat for 72 hours. Keep 72 hourly points for the link and a finer path for drawing.
- The route must be ready in under 2 seconds on a mid-range phone; the launch animation covers that time.
- Keep the last few days of runs available so a release always has data; if the newest run is late, use the previous one.

## 12. How it should be built

- Static site, no backend, no database. A build tool such as Vite is fine. three.js for the 3D world. Map tiles decoded and turned into meshes in a Web Worker so the screen never freezes.
- Level of detail by distance: full detail (buildings, roofs, trees, terraces) near the balloon; simplified ground in the middle distance; large coarse tiles fading into haze at the horizon. Hard caps on triangles and draw calls; draw each kind of object in batches (instancing).
- Performance budget: something on screen within 2 seconds on a mid-range phone over 4G, a smooth frame rate while flying, screen sharpness capped at about 1.5x, live shadows only near the balloon, no full-screen blur effects.
- Prove the data first (shared rules): before building the world, show SK a real GFS sample turned into a real route from a real town, and real map tiles turned into a real piece of town.
- Use the superpowers skills for planning, test-driven development and reviews. Use the impeccable skill for every interface and look decision (its craft floor and critique) and the unslop skill to check the interface chrome. Check what you build by looking at it on a phone-sized screen.
- Deploy: GitHub plus Cloudflare Pages. An optional own web address costs about £10 to £15 a year.
- Accounts: SK has a GitHub account. He does not yet have a Cloudflare account: walk him through creating one, click by click, at the very start.
- Testing: a Claude artifact link cannot load the outside map, terrain and wind data, so SK tests on Cloudflare Pages preview links from the first milestone onwards, on his phone.

## 13. Suggested build order

0. Set up: walk SK through creating a Cloudflare account; create the public GitHub repository; connect Cloudflare Pages so every change gets a preview link SK can open on his phone.
1. Data proof: GFS winds to a route from a real town, drawn as a simple line; one real map tile turned into faceted ground, buildings and trees in Contour.
2. The streaming world around a moving point, with level of detail, haze and day and night lighting.
3. The balloon, the person and the launch at street level; the directed camera.
4. Live mode (route over real time), links and "Your balloons".
5. Whole-trip replay and the landing card with sharing.
6. Regional building styles and the launch batch of landmarks (24 cities), with SK's sign-off on any with a rights note.
7. Polish, phone performance, fallbacks, credits footer, deploy.
8. Hand back to SK: the live link, three phone-sized screenshots, a plan for a 10 to 20 second screen recording, and three hook ideas for the post.
9. After launch: the remaining Tier 1 landmarks in weekly batches, then Tier 2.

## 14. Left to the builder

- Exact file format and tiling of the wind data, and the integration step.
- Exact palettes per region and per time of day, within the Contour direction.
- How landmarks are modelled (in code or as small model files), as long as they match the style and stay small.
- Any wording beyond the strings fixed in 7.4, in the same plain British English.
- The look of the 2D fallback, within the Contour palette.

## 15. Decisions from the builder check

Answered by SK:
- "Use my location" means the exact GPS position, nothing else (section 6.6).
- Flight height: storybook height at launch, true height after about 5 minutes, with tight physics (sections 6.2 and 11).
- Scope: launch with a first batch of 24 cities, then weekly batches (section 10).
- Hosting: a public GitHub repository is fine. SK has GitHub and needs a Cloudflare account (sections 12 and 13).

Decided by Claude during planning (SK can overrule):
- Over high ground the balloon keeps its clearance above the terrain and reads winds at its true altitude; it always flies the full 72 hours (section 6.7).
- The balloon's shadow is a soft, stylised game shadow under it, strongest during the low early phase and in wide shots; it does not need to be physically exact.
- Testing happens on Cloudflare Pages preview links, not Claude artifact links (section 12).
