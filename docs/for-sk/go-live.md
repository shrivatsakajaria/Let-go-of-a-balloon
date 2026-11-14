# Going live

This page says what "going live" means for Let go of a balloon, what I (Claude) will do once you say yes, and what you have to click. The short answer: say yes, then switch one job off and on and check one email setting (about two minutes), and switch on visitor numbers in Cloudflare (about a minute). There is one more setting you might be asked to change yourself, also about a minute.

Written 14 November 2026.

## The two addresses

Cloudflare keeps two kinds of address for the site.

| Address | What it is | Where it comes from |
| --- | --- | --- |
| https://let-go-of-a-balloon.pages.dev | **The live site.** The address you post. | Whatever GitHub publishes under the name `main` |
| https://claude-new-session-31f9yr.let-go-of-a-balloon.pages.dev | **The preview.** Where you have been checking my work. | Whatever GitHub publishes from my work branch |

Cloudflare decides which is which by the branch name. A branch is a separate line of work in the GitHub project. Cloudflare treats the branch called `main` as the live site, and every other branch as a preview. That was set up when the project was first created, and it does not need changing.

## What happens today

The GitHub project has only one branch so far: my work branch, `claude/new-session-31f9yr`. There is no `main` branch yet.

There are two automatic jobs.

1. **Deploy.** It runs every time I send a change to GitHub, and publishes it to the preview address. It also runs on two timers, each about once an hour, to fetch the newest wind forecast. The timer runs always publish to the **live** address.
2. **Keep alive.** On the 1st of each month it makes one tiny change to `main`, so GitHub keeps the timers switched on. Until `main` exists, it does nothing.

The wind job does not write anything into the GitHub project itself. It keeps the downloaded winds in GitHub's own storage and publishes them straight to Cloudflare, together with the site.

**Something you should know.** GitHub starts timer runs from the project's "default branch", which today is my work branch. So the live address is already up, and it shows the same version as the preview. I checked: the timer runs at 20:31 on 13 November, and at 01:29 and 09:05 UTC on 14 November, all published to the live address. Nobody knows that address yet, so this does no harm. But from now on the live site should only ever show work you have approved.

## The change I have made

I changed the Deploy job so that, once `main` exists, the hourly wind refresh always builds the site from `main`. It no longer depends on which branch is the default. Until `main` exists, nothing changes, and the preview works exactly as before.

This change is on my work branch, in its own commit: "ci: the hourly wind refresh builds main once main exists".

## What does not need changing

- **The GitHub secrets.** `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` belong to the whole project, so `main` can use them too. The token is allowed to publish to Cloudflare Pages, which covers the live site.
- **Cloudflare.** The live branch is already set to `main`. Apart from one switch for visitor numbers (below), you do not need to open Cloudflare.
- **Money.** The live site costs the same as the preview: nothing.

## What I will do when you say yes

1. Check everything one last time: all the automatic tests, and the preview on a phone-sized screen.
2. Send the finished work to GitHub, so the preview shows exactly what will go live.
3. In one go: create the `main` branch from my work branch, and make `main` the project's default branch. The default branch is the one GitHub's timers, the **Run workflow** button and the project's front page use. Doing both together means there is no gap where they point at the wrong branch. My GitHub access should let me do this. If GitHub refuses the second half, I stop and ask you to do it straight away (see below).
4. Creating `main` starts the Deploy job for `main`. It runs every check first, and only publishes if they all pass. This takes a few minutes. I watch it until it shows a green tick. If it says "cancelled" instead, that is harmless (a timer run took its place), and step 5 covers it.
5. Run Deploy once more by hand, on `main` (**Actions**, **Deploy**, **Run workflow**, branch `main`). Why: GitHub keeps the downloaded winds in a store that belongs to each branch, and `main` starts with an empty one. This run fills `main`'s store, and its last step checks that the live site's newest forecast is fresh. I wait for the green tick and read that line in the run's summary.
6. Open https://let-go-of-a-balloon.pages.dev and check that the page loads and lets a balloon go with today's winds.
7. Start the Keep alive job once by hand, to check it can write to `main`.
8. Ask you to do the 5-minute phone test in `phone-test.md`, on the live address.
9. Fill in the live link in `handback.md`.
10. Ask you to make the timer emails yours (below).

After that, my changes go to a preview first, as now. Only when you have said OK do I copy them to `main`, which updates the live site. Before copying, I bring the monthly Keep alive changes on `main` back into my work branch, so the copy is a simple step forward.

## What you should click

One thing, about two minutes, just after go-live: make sure GitHub's "run failed" emails reach you. Those emails are how you would hear that the winds are getting old. GitHub sends them to whoever last switched the Deploy job on, which may be a robot account today, so:

1. Open https://github.com/shrivatsakajaria/Let-go-of-a-balloon and click the **Actions** tab.
2. In the left-hand list, click **Deploy**.
3. Near the top right, click the **...** button, then **Disable workflow**.
4. In the grey box that appears, click **Enable workflow**.
5. Open https://github.com/settings/notifications, scroll to **System**, then **Actions**, and make sure **Email** is ticked under **Notify me**.

The same steps, with a little more explanation, are under "Make sure the emails reach you" in `03-keep-it-running.md`.

## Visitor numbers (after go-live, about a minute)

The site counts visits and a few presses anonymously (no cookies, nothing that identifies anyone). The counting of presses starts by itself on the live site. For visits, countries and devices, switch on Cloudflare Web Analytics once:

1. Open https://dash.cloudflare.com and sign in.
2. In the left-hand menu, click **Workers & Pages**.
3. Click **let-go-of-a-balloon**.
4. Click the **Metrics** tab.
5. Find **Web Analytics** and click **Enable**.
6. Tell me in chat "Web Analytics is on".

Later, ask me "how many people let go yesterday?" in any session. The first time, I show you a secure form for a read-only key; you never paste it in chat. `analytics.md` has the details, including how to make that key.

## What you might have to click

Only if I tell you GitHub refused me in step 3. It takes about a minute.

1. Open https://github.com/shrivatsakajaria/Let-go-of-a-balloon and sign in.
2. Click **Settings**. It is in the row of tabs near the top. On a phone, it may be under a **...** menu.
3. You are now on the **General** page. Scroll down to **Default branch**.
4. It shows `claude/new-session-31f9yr`. Click the button with two arrows next to it (its label is **Switch to another branch**).
5. In the list, click **main**.
6. Click **Update**.
7. GitHub asks you to confirm. Click **I understand, update the default branch**.
8. Tell me in chat "I've switched the default branch".

You never need to copy, paste or send me a password or token for any of this.

## If something goes wrong

- **The Deploy run shows a red cross.** The live site stays as it was. Nothing broken goes out, because the checks run before anything is published. Tell me and I will fix it.
- **The live site looks different from the preview.** Tell me which address you opened and what you saw.
- **GitHub emails you that a timer has been switched off, or that a Deploy run failed.** This one is urgent. Follow `03-keep-it-running.md`.

## A note on the hourly timers

GitHub runs timers when it has spare capacity, not to the minute. In the 30 hours before I wrote this, the wind job ran only 5 times, and on 13 November a gap and a failed run together left the site without usable winds for a while. So there are now two timers, half an hour apart. The US weather service publishes a new forecast every 6 hours, and the site now keeps using a forecast for up to 48 hours (each one reaches 5 days ahead, enough for a whole 3-day flight even when it is 2 days old).

If the newest forecast on the live site is ever more than 18 hours old, the Deploy run shows a red cross and GitHub emails you. That leaves more than a day before "Let go" stops working. `03-keep-it-running.md` says what to do.

## Rules on `main` (only if you add them)

GitHub lets you protect a branch, for example so that nobody can change `main` directly. Nothing like that is switched on, and you do not need it. If you ever turn on such a rule for `main`, the Keep alive job will fail, because it changes `main` directly. In the rule's settings, add **GitHub Actions** to the list of those allowed to bypass it, or ask me to.

## If you get your own web address

`handback.md` says how to buy one. Once it works, tell me. The site's address is written in one place in the code (`SITE_URL` in `src/config.ts`), which feeds the link preview LinkedIn and X show and the Deploy job's checks. I change that line and the address printed on the landing card, and check the site on the new address. The `pages.dev` address keeps working too.
