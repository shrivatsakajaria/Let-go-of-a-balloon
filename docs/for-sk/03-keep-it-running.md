# 3. Keep the site working

The site needs fresh wind forecasts. A GitHub job called **Deploy** fetches them. It runs on two timers, each about once an hour.

## Why this matters

Each forecast reaches 5 days ahead. A balloon flies for 3 days. So the site can use a forecast for up to 2 days (48 hours). After that, the forecast no longer reaches the end of a flight.

If Deploy stops running, or keeps failing, nothing looks wrong at first. But 48 hours after the last good forecast, "Let go" stops working. Everyone who taps it sees "We can't get today's winds right now". Links people have already shared keep working.

So a failed or switched-off Deploy is **urgent**. You have about a day and a half to sort it out.

## How you would find out

- **GitHub emails you that a Deploy run failed.** Deploy checks the live site every time it runs. If the newest forecast there is more than 18 hours old, the run fails on purpose, so that GitHub emails you. It keeps failing (and emailing) until the winds are fresh again.
- **GitHub emails you that it has switched a timer off.** In a public project, GitHub switches timers off after 60 days with no activity. Nothing is deleted, but the forecasts stop.

### Make sure the emails reach you (once, after go-live, about two minutes)

GitHub sends the email about a failed timer run to one person only: whoever last changed the timers, or last switched the job off and on. Today that may be a robot account, so the email could reach nobody. Switching Deploy off and straight back on makes it you.

**Part 1: make the timer emails yours**

1. Open https://github.com/shrivatsakajaria/Let-go-of-a-balloon and sign in.
2. Click the **Actions** tab.
3. In the left-hand list, click **Deploy**.
4. Near the top right, above the list of runs, click the **...** button.
5. Click **Disable workflow**. The timers pause.
6. A grey box now says the workflow is disabled. Click **Enable workflow** in it. The timers are back on, and their emails now come to you.

Do both clicks one after the other. A minute or two off does no harm.

**Part 2: check your email settings**

1. Open https://github.com/settings/notifications.
2. Scroll down to **System**, then **Actions**.
3. Make sure **Email** is ticked under **Notify me**. You can also tick **Only notify for failed workflows**, so you only hear when something is wrong.
4. If GitHub shows a **Save** button, click it.

If you see a red cross on the **Actions** tab but never got an email, tell Claude.

### Keep alive

A job called **Keep alive** makes one tiny change to `main` on the 1st of each month. That counts as activity, so the timers stay on. You do not need to do anything for it.

## What to do

Do these the same day.

**If a timer was switched off:**

1. Open https://github.com/shrivatsakajaria/Let-go-of-a-balloon
2. Click the **Actions** tab.
3. In the left-hand list, click the workflow that has a warning, such as **Deploy**.
4. Click the **Enable workflow** button.
5. Then do the steps below, to fetch a forecast straight away.

**If a Deploy run failed, or after turning a timer back on:**

1. Open https://github.com/shrivatsakajaria/Let-go-of-a-balloon
2. Click the **Actions** tab.
3. In the left-hand list, click **Deploy**.
4. On the right, click **Run workflow**. Check the branch says `main`, then click the green **Run workflow** button.
5. Wait about 10 minutes, then reload the page. If the new run at the top has a green tick, you are done.
6. If it has a red cross, tell Claude, and paste the link to the failed run (the address bar while the run is open). Do not paste any passwords or tokens. A failed run never breaks the site that is already live, but the winds stay old until it is fixed.

If you cannot get to a computer, the email itself is enough to tell Claude: "Deploy failed, please look".
