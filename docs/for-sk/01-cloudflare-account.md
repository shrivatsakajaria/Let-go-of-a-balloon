# 1. Set up Cloudflare

Cloudflare is the company that will host the website. The free plan is enough. You do not need a card.

You will end up with two things to keep safe:

- your **Account ID** (a long string of letters and numbers);
- an **API token** (a secret password that lets GitHub publish the site for you).

## Create the account

1. Go to https://dash.cloudflare.com/sign-up
2. Type your email address and choose a password.
3. Click **Sign up**.
4. Open the email from Cloudflare and click the link to confirm your address.
5. If Cloudflare asks you to add a website or choose a plan, look for a small link that says **Skip** or **Go to dashboard**. You do not need to add a domain.
6. If it asks you to pick a plan, choose **Free**.

## Find your Account ID

1. Sign in at https://dash.cloudflare.com
2. In the left-hand menu, click **Workers & Pages**.
3. On the overview page, look at the right-hand side. You will see **Account ID**.
4. Click **Click to copy** next to it.
5. Paste it somewhere safe for now, such as a note on your phone.

The same ID also appears in the address bar. After `dash.cloudflare.com/` there is a long string of letters and numbers. That is your Account ID.

## Create the API token

The token should be allowed to do one thing only: publish to Cloudflare Pages.

1. Click your profile icon at the top right, then **My Profile**.
2. In the left-hand menu, click **API Tokens**.
3. Click **Create Token**.
4. Scroll to the bottom and next to **Create Custom Token**, click **Get started**.
5. Give it a name, for example `let-go-of-a-balloon`.
6. Under **Permissions**, set the three boxes to:
   - first box: **Account**
   - second box: **Cloudflare Pages**
   - third box: **Edit**
7. Under **Account Resources**, set the two boxes to **Include** and then your own account.
8. Leave everything else as it is.
9. Click **Continue to summary**, then **Create Token**.
10. Cloudflare now shows the token **once only**. Click **Copy**.
11. Paste it into a safe note straight away.

If you lose the token, do not worry. Delete it and make a new one.

## Where each value goes

Both values go into GitHub. The next guide, `02-github-secrets.md`, shows you how.

| Value | GitHub name |
| --- | --- |
| Account ID | `CLOUDFLARE_ACCOUNT_ID` |
| API token | `CLOUDFLARE_API_TOKEN` |

Never send the token in an email or paste it into a chat.
