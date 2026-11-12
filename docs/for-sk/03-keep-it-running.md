# 3. Keep the site updating

The site refreshes its wind data every hour. GitHub runs that job on a timer.

## The catch

In a public project, GitHub switches timers off after 60 days with no activity. Nothing is deleted. The site just stops updating.

## What stops it happening

A second job called **Keep alive** makes one tiny change to the `main` branch on the 1st of each month. That counts as activity, so the timer stays on. You do not need to do anything.

## If the updates stop anyway

GitHub emails you when it switches a timer off. To turn it back on:

1. Open https://github.com/shrivatsakajaria/Let-go-of-a-balloon
2. Click the **Actions** tab.
3. In the left-hand list, click the workflow that has a warning, such as **Deploy**.
4. Click the **Enable workflow** button.

That is all. It takes one click.
