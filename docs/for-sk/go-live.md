# Going live

This page says what "going live" means for Let go of a balloon, what I (Claude) will do once you say yes, and what you have to click. The short answer: you only need to say yes. There is one setting you might be asked to change yourself, and it takes about a minute.

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

1. **Deploy.** It runs every time I send a change to GitHub, and publishes it to the preview address. It also runs on a timer, about once an hour, to fetch the newest wind forecast. The timer run always publishes to the **live** address.
2. **Keep alive.** On the 1st of each month it makes one tiny change to `main`, so GitHub keeps the timer switched on. Until `main` exists, it does nothing.

The wind job does not write anything into the GitHub project itself. It keeps the downloaded winds in GitHub's own storage and publishes them straight to Cloudflare, together with the site.

**Something you should know.** GitHub starts timer runs from the project's "default branch", which today is my work branch. So the live address is already up, and it shows the same version as the preview. I checked: the timer runs at 20:31 on 13 November, and at 01:29 and 09:05 UTC on 14 November, all published to the live address. Nobody knows that address yet, so this does no harm. But from now on the live site should only ever show work you have approved.

## The change I have made

I changed the Deploy job so that, once `main` exists, the hourly wind refresh always builds the site from `main`. It no longer depends on which branch is the default. Until `main` exists, nothing changes, and the preview works exactly as before.

This change is on my work branch, in its own commit: "ci: the hourly wind refresh builds main once main exists".

## What does not need changing

- **The GitHub secrets.** `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` belong to the whole project, so `main` can use them too. The token is allowed to publish to Cloudflare Pages, which covers the live site.
- **Cloudflare.** The live branch is already set to `main`. You do not need to open Cloudflare at all.
- **Money.** The live site costs the same as the preview: nothing.

## What I will do when you say yes

1. Check everything one last time: all the automatic tests, and the preview on a phone-sized screen.
2. Send the finished work to GitHub, so the preview shows exactly what will go live.
3. Create the `main` branch from my work branch. GitHub then runs the Deploy job for `main`. It runs every check first, and only publishes if they all pass. This takes a few minutes.
4. Watch that run until it shows a green tick. Then open https://let-go-of-a-balloon.pages.dev and check that the page loads with today's winds.
5. Make `main` the project's default branch, so GitHub's timers, the **Run workflow** button and the project's front page all use `main`. My GitHub access should let me do this. If GitHub refuses, I will ask you to do it (see below).
6. Start the Keep alive job once by hand, to check it can write to `main`.
7. Ask you to do the 5-minute phone test in `phone-test.md`, on the live address.
8. Fill in the live link in `handback.md`.

After that, my changes go to a preview first, as now. Only when you have said OK do I copy them to `main`, which updates the live site.

## What you might have to click

Only if I tell you GitHub refused me in step 5. It takes about a minute.

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
- **GitHub emails you that a timer has been switched off.** Follow `03-keep-it-running.md`. It is one click.

## A note on the hourly timer

GitHub runs timers when it has spare capacity, not to the minute. In the 30 hours before I wrote this, the wind job ran 5 times. That is enough, because the US weather service only publishes a new forecast every 6 hours, and the site happily uses a forecast up to 24 hours old.
