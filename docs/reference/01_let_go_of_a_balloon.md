# 01 · Let Go of a Balloon

**Release a balloon from your town and watch today's real winds carry it for three days.**

Read `00_shared_rules.md` first.

## The idea

You type your town, or tap "use my location". A balloon floats up and drifts across a map, following the real forecast winds hour by hour for 72 hours. Everyone gets a different path, and the path changes every day.

## Why people will click

- It is about their own town.
- It is different every day, so people come back and compare.
- The landing spot is a surprise: "Mine ended up in Norway."

## What the visitor does

1. Enters a town, or uses their location.
2. Presses **Let go**.
3. Watches the balloon drift while a clock ticks through the three days.
4. Sees where it landed, how far it travelled and its top speed.
5. Shares a card: "My balloon from Manchester landed in ___."

## The wow moment

The balloon lifts off and its trail sweeps across countries in a few seconds. Then the landing card appears.

## Data (all free)

- **Open-Meteo forecast data:** hourly wind speed and direction at height, using pressure levels. 850 hPa is roughly 1.5 km up. The forecast covers up to 16 days ahead, and we need three.
- **Terms:** free for non-commercial use, under 10,000 calls a day. The licence is CC BY 4.0, so show "Weather data by Open-Meteo.com" with a link.
- **Town search:** Open-Meteo's free place-name search.
- **Map:** free map tiles (for example OpenStreetMap), credited as their terms require.

## How it's built

- One page, with no login and no database.
- The path is worked out in the browser. Every hour, it reads the wind where the balloon is, moves the balloon, and repeats for 72 hours.
- Keep calls low. Open-Meteo accepts many locations in one call, so fetch winds for a grid of points in a few batched calls, not one call per hour.
- Optional: let people choose a height (low, middle or high). Different heights give very different paths.

## Nice extras (later)

- Buttons to release from famous places.
- Compare today's balloon with yesterday's.
- See everyone's balloons today. This needs a small database, so add it later.

## Watch-outs

- Say clearly that it is a simulation using forecast winds, not a real balloon.
- Handle the balloon going over open sea, off the map edge, or near the poles.
- If it goes viral and calls approach 10,000 a day, save results by town and hour so they can be reused.

## Done means

- [ ] It works on a phone, and the path draws in under 5 seconds.
- [ ] The landing card shows distance and the place name.
- [ ] There is a shareable image of the path.
- [ ] The credits footer is in place.

## The post angle

"I let go of a balloon from Manchester. Today's winds took it to ___." Post it with a screen recording of the drift.
