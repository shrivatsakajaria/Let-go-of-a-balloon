# Weekend builds: shared rules (read first)

Owner: SK (Still Signal). Written 12 November 2026.

## What this is

Five small web apps, built one per chat, then posted on LinkedIn and X under Still Signal as builder posts. Each one is a single page that people can open on their phone, use in under a minute, and share. They are built with AI, and we say so openly.

## Rules for every build

- **Free public data only.** No paid data and no paid services.
- **Non-commercial.** No ads, no charging, no sign-ups. The terms of the free data and free hosting depend on this.
- **No logins and no personal data.** If a feature needs to save something (a leaderboard, say), use a nickname only, and add it only after the core app works.
- **Credit every data source** in a small footer, with a link. Some licences (for example CC BY 4.0) require it.
- **Mobile first.** It must work and look good on a phone. Most clicks will come from the LinkedIn app.
- **Fast.** Something useful on screen within about 2 seconds. Where possible, prepare the data in advance and ship it as a file, instead of calling a data service on every visit.
- **British spelling.** Short, plain words on screen.
- **Talk to SK in very simple, plain language.** He is not technical. When he has to do a step himself, explain it click by click.

## Look and feel

- **Visually striking.** A screenshot should stop someone scrolling on its own.
- **It must not look like a default AI-made site.** Avoid Inter and Fraunces, and avoid generic purple gradients.
- **Match Still Signal where it fits:** bold condensed headlines, dark backgrounds, one orange accent. Use the Still Signal design system if it is available in this session.
- **No hard dark boxes behind text, and no glow or drop shadow behind text.**
- **Footer:** data credits plus "A Still Signal build".

## How each chat should run

1. Read this file and the project brief.
2. **Prove the data first.** Fetch a real sample and show SK it works before building anything else.
3. Build the smallest version that delivers the "wow moment" in the brief.
4. Publish it as a Claude artifact link so SK can test it on his phone.
5. Polish it, then fix what SK flags.
6. **Deploy:** GitHub (free), then Cloudflare Pages (free). Walk SK through it click by click.
7. **Hand back:**
   - the live link;
   - three phone-sized screenshots;
   - a plan for a 10–20 second screen recording;
   - three hook ideas for the post.

   The post copy itself is written in the usual post chat.

## Hosting and costs

- **GitHub plus Cloudflare Pages:** £0. An optional own web address costs about £10–15 a year, with each app at its own sub-address.
- **Small helper:** if a data source blocks browsers, use Cloudflare Workers. It is free for 100,000 uses a day.
- **Database:** only if needed later, for leaderboards. Use Firebase's free plan, which stops when it hits a limit rather than charging.

## Build order

1. Let Go of a Balloon
2. Your Town in 2050
3. Don't Press Sell
4. The Island That Feeds the Cloud
5. 2026 in 365 Articles (launch in December)
