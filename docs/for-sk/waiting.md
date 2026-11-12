# Waiting on SK

Things that need you before everything works. Tick them off as you go.

- [ ] **Create the Cloudflare account** (`01-cloudflare-account.md`). Without it, there is nowhere to publish the site.
- [ ] **Add the two secrets in GitHub** (`02-github-secrets.md`): `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Until then, the workflow builds the site but skips publishing, so there is no preview link yet. The workflow still shows a green tick.

When both are done, open the **Actions** tab, run **Deploy** once, and open the preview link on your phone.

## Cross-origin check

Checked on 12 November 2026 from a local machine, using the preview address as the origin. The map tiles, the place search and the terrain data all allowed it. Nothing is waiting on this.
