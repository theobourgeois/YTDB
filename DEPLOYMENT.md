# Publishing YTDB

Publish the `ytdb` npm package first, then deploy the Next.js UI at
`https://ytdb.theobourgeois.com` so the hosted UI never gets ahead of the local bridge API.

## npm

```bash
npm login
npm publish
```

The unscoped `ytdb` package name is available as of September 3, 2026. The `prepack` script
builds the production app automatically. Increment the version before every later release.

## Vercel and Squarespace DNS

Import `https://github.com/theobourgeois/YTDB` into Vercel with the detected Next.js defaults.
No environment variables are required. Add `ytdb.theobourgeois.com` in **Settings → Domains**,
then add the exact CNAME record Vercel provides in Squarespace DNS:

- Type: `CNAME`
- Host: `ytdb`
- Value: the project-specific Vercel CNAME target

Do not change the domain's nameservers. Vercel provisions HTTPS after the record verifies.

## Verify

`curl -i https://ytdb.theobourgeois.com/api/health` must return a 404 with
`{"error":"Database API is local-only"}`. Then `npx ytdb` should open a browser tab connected
to the authenticated local bridge.

Browser storage cannot cross origins. Export config from the old local origin before removing
its hostname mapping, then import that file at the hosted origin.

Connection URLs remain in `localStorage` under the hosted origin. They are not stored by
Vercel, but deployed YTDB JavaScript can read them. Keep the site free of third-party scripts,
protect GitHub and Vercel with 2FA, and use least-privilege PostgreSQL roles.
