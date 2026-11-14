# Visitor numbers

This page says what the site counts, what it never counts, and how to ask me (Claude) for the numbers later. There is nothing to switch on. You never paste a password or token into the chat.

Written 14 November 2026.

## What is counted

Everything comes from the site's own small counter, and all of it is anonymous.

1. **Visits**: how many people open the site or a shared balloon link, which country they are in, which site sent them (just its name, for example `www.linkedin.com` or `t.co`, never the page they were on), and whether they use a phone, tablet or computer.
2. **What people do**: how many press Let go (and whether from a featured city, a searched place or their own location), watch the whole trip, see the landing card, share it, save it or copy its link, add the calendar reminder, open a shared link (and whether that balloon had already landed), switch views, and roughly how long they stay (in bands: under 10 seconds, 10 to 30 seconds, and so on up to over 10 minutes).

## What is never counted

- No cookies, and nothing saved on the visitor's phone to recognise them next time.
- No IP address is kept, and nothing that could identify a person.
- No positions and no place names. A featured city (London, Paris, New York, Tokyo, Sydney, Rio de Janeiro, Cappadocia) is counted by name, because everyone sees those. A searched place or "Use my location" is only counted as "a search" or "a location", never which one.
- Anyone whose browser has **Global Privacy Control** switched on sends nothing at all.
- The previews, and my automatic tests, never count.

The About sheet on the site says: "Visits are counted anonymously: no cookies, nothing that identifies you."

## Cost

Nothing. The counter uses Cloudflare's Workers Analytics Engine, which on the free plan allows 100,000 counts and 10,000 look-ups a day, far more than the site needs. Cloudflare keeps the counts for three months.

## What you click

Nothing. The counter starts by itself the first time someone opens the live site.

If, a day after go-live, I tell you the numbers say "dataset not found", there is one place to look: in https://dash.cloudflare.com, click **Workers & Pages**, then **Analytics Engine** in the left-hand menu or on the overview page. If it shows a **Set up** button, click it. Older accounts sometimes needed this; newer ones do not.

## How far to trust the numbers

They are good for trends, not exact. Someone could run a program that pretends to visit the site, and that would make the numbers look bigger than they are. If that ever happens and you have your own web address by then, I can add a Cloudflare rule that limits how often one visitor can be counted.

## Asking me for the numbers

In any future Claude session on this project, just ask, for example:

- "How many people let go yesterday?"
- "How many visits this week, and from which countries?"
- "How many people shared their card in the last 30 days?"

The first time, I need a **read-only key** to Cloudflare's numbers. I will show you a secure form for it. The key goes into that form, never into the chat, and it is stored with your Claude settings for this project so you only do this once.

### Making the read-only key

Do this when I show you the form, not before (Cloudflare shows the key only once).

1. Open https://dash.cloudflare.com/profile/api-tokens and sign in.
2. Click **Create Token**.
3. Scroll to **Create Custom Token** and click **Get started**.
4. **Token name**: type `Balloon numbers (read only)`.
5. Under **Permissions**, set the three boxes to **Account**, **Account Analytics**, **Read**. Add nothing else.
6. Under **Account Resources**, choose **Include**, then your account.
7. Leave everything else as it is. Click **Continue to summary**.
8. Check the summary says only **Account Analytics: Read**. Click **Create Token**.
9. Click **Copy** next to the key, and paste it into the secure form I showed you. Click **Save** in the form.
10. Close the Cloudflare page. Do not keep the key anywhere else.

This key can only read numbers. It cannot change the site, publish anything, or see anything about your account other than its statistics.

If you lose it or want to stop me reading the numbers, go back to https://dash.cloudflare.com/profile/api-tokens, click the **...** next to the key, and click **Delete**.

## For me (Claude): reading the numbers

- `node scripts/stats.mjs --yesterday` (or `--days 7` up to `--days 31`, `--date 2026-11-13`) prints the summary. It reads the key from `CF_ANALYTICS_TOKEN`, or relies on the session's saved credential for `api.cloudflare.com` (the proxy adds the header). It never prints the key.
- No key yet: ask for one with the secure credential form for host `api.cloudflare.com`. Never ask SK to paste it in chat.
- The account is `d09a4e2d2ffe34fc1dc94d13f30da27d` (not a secret). The events are in the Analytics Engine dataset `lgoab_events` (blob1 event, blob2 detail, blob3 featured city, blob4 country, and for `start_view` and `link_open` blob5 device class and blob6 referrer hostname; weight rows by `_sample_interval`).
- Counts are presses, not people: one visitor who opens the card twice counts twice. A visit is a `start_view` or a `link_open` (a page load), not a unique person.
- If a deploy ever failed with `wrangler.toml`, the Deploy workflow retried without it and warned ("Deployed without analytics"): then nothing is counted until that is fixed.
