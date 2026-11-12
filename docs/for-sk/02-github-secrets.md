# 2. Give GitHub the two Cloudflare values

The GitHub project already exists. It is public, and you can open it here:

https://github.com/shrivatsakajaria/Let-go-of-a-balloon

You only need to add two secrets. A secret is a saved value that GitHub keeps hidden. Nobody can read it back after you save it.

You need the Account ID and the API token from `01-cloudflare-account.md`.

## Add the first secret

1. Open https://github.com/shrivatsakajaria/Let-go-of-a-balloon and sign in.
2. Click **Settings**. It is in the row of tabs near the top. On a phone, it may be under a **...** menu.
3. In the left-hand menu, click **Secrets and variables**. Then click **Actions**.
4. Click the green **New repository secret** button.
5. In **Name**, type exactly: `CLOUDFLARE_API_TOKEN`
6. In **Secret**, paste the API token.
7. Click **Add secret**.

## Add the second secret

1. Click **New repository secret** again.
2. In **Name**, type exactly: `CLOUDFLARE_ACCOUNT_ID`
3. In **Secret**, paste the Account ID.
4. Click **Add secret**.

You should now see both names in the list. The values stay hidden.

## Check that it worked

Each time Claude pushes a change, GitHub starts a run by itself. You do not need to press anything.

The easiest way: tell Claude in chat "I've added the secrets". Claude will push a small change to start a fresh run.

Then look at the result:

1. Open https://github.com/shrivatsakajaria/Let-go-of-a-balloon
2. Click the **Actions** tab at the top.
3. The run at the top of the list is the latest one. Click its name.
4. A green tick next to it means it worked. A red cross means something went wrong. If so, tell Claude.
5. A yellow circle means it is still running. Wait a minute or two and refresh the page.

Before you add the secrets, the run still shows a green tick. It builds the site but skips publishing. The summary says "Deploy skipped".

Later, once the site is live on the `main` branch, there will also be a **Run workflow** button. Open **Deploy** in the left-hand list of the Actions tab and click it to start a run by hand. It does not appear before then.

## Where to find the preview link

1. Click the latest run in the **Actions** tab.
2. Scroll down to **Summary**.
3. Under **Deployed**, you will see a **Preview link** ending in `.pages.dev`.
4. Open it on your phone. You should see the page "Let go of a balloon".

Every time code is pushed to a branch, GitHub makes a new preview link. The branch called `main` is the live site: https://let-go-of-a-balloon.pages.dev
