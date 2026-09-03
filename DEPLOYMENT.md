# Publishing YTDB

YTDB has two release surfaces that should be published in this order:

1. The `@theobourgeois/ytdb` npm package, which runs the authenticated local database bridge.
2. The Next.js UI, hosted at the origin configured in [`ytdb.config.mjs`](./ytdb.config.mjs),
   currently `https://ytdb.theobourgeois.com`.

Publishing the bridge first prevents the hosted UI from getting ahead of the local API.

## 1. Publish the npm package

npm rejects the unscoped `ytdb` name as too similar to existing packages, so YTDB uses the
official `@theobourgeois` scope.

```bash
npm login
npm publish
```

The `prepack` lifecycle builds the production app automatically. Verify the public package
from a directory outside this repository:

```bash
npx @theobourgeois/ytdb@latest --version
npx @theobourgeois/ytdb@latest
```

From inside this repository, use
`npx --yes --package=@theobourgeois/ytdb@latest -- ytdb` to force npm to use the registry
package instead of mistaking the source checkout for an installed executable.

Future releases must increment `version` in `package.json` before publishing.

## 2. Deploy the UI to Vercel

Import `https://github.com/theobourgeois/YTDB` as a new Vercel project and keep the detected
Next.js defaults. No environment variables are required. Vercel automatically sets `VERCEL=1`;
YTDB uses that flag to disable every database API route on the public deployment.

After the first production deployment, add `ytdb.theobourgeois.com` under the project's
**Settings → Domains**. Vercel will display the exact DNS record for the project.

## 3. Add the Squarespace DNS record

The domain currently uses Squarespace nameservers, so add the record in the Squarespace DNS
dashboard rather than Vercel DNS:

- Type: `CNAME`
- Host: `ytdb`
- Value: `364942a787be1930.vercel-dns-017.com`

Do not replace the nameservers for `theobourgeois.com`; that could disrupt the existing site
and email. Only add the `ytdb` CNAME. Once Vercel verifies it, HTTPS is provisioned
automatically.

## Switching the hosted domain

`ytdb.config.mjs` is the only place a domain is hardcoded. `bin/ytdb.mjs` opens
`HOSTED_ORIGIN` in the browser, and `src/proxy.ts` uses it as the local bridge's CORS
allowlist, so both move together.

To move to a new domain — `https://db.listen.yt`, for example:

1. Point DNS at the Vercel project and add the domain under **Settings → Domains**. Confirm it
   serves the app over HTTPS *before* changing any code; a domain that does not resolve yet
   will strand every user the moment a package using it is published.
2. In `ytdb.config.mjs`, set `HOSTED_ORIGIN` to the new origin and add the outgoing origin to
   `ALSO_TRUSTED_UI_ORIGINS`, so bridges from already-installed package versions keep working:

   ```js
   export const HOSTED_ORIGIN = "https://db.listen.yt";
   export const ALSO_TRUSTED_UI_ORIGINS = ["https://ytdb.theobourgeois.com"];
   ```

   Only list domains that are currently registered and under your control. An origin here may
   talk to the local database bridge, so a domain that lapses and is registered by someone else
   inherits that trust.
3. Update `homepage` in `package.json`, bump `version`, then publish and deploy as above.
4. Keep the old domain attached to the Vercel project until published packages that open it are
   no longer in use. Saved connections live in `localStorage` per origin, so users switching
   domains must **Export config** on the old origin and import it on the new one.

Nothing needs to be rebuilt to test a different origin locally — the CLI accepts an override
and passes it to the bridge, so the CORS allowlist follows:

```bash
npx @theobourgeois/ytdb --origin https://db.listen.yt
YTDB_HOSTED_ORIGIN=https://db.listen.yt npx @theobourgeois/ytdb
```

## Security checks after deployment

```bash
curl -i https://ytdb.theobourgeois.com/api/health
```

The hosted API must return `404` with `{"error":"Database API is local-only"}`. Then run
`npx @theobourgeois/ytdb`; the opened browser tab should connect to the local bridge and show the connection
list.

## Move existing browser data

Browser storage cannot cross origins automatically. Before removing the old hostname entries,
run the development server and open the origin where the connections were saved—usually
`http://local.dbstudio` or `http://local.ytdb`. YTDB automatically copies the old DB Studio
storage keys on that origin. Use **Export config**, then import the JSON file in
`https://ytdb.theobourgeois.com` after launching the bridge.

The old launch daemons and `/etc/hosts` entries can be removed after that export. The exact
installed labels are `com.dbstudio.local-proxy` and `com.ytdb.local-proxy`.

Connection URLs remain in browser `localStorage` under the hosted origin. They are not stored
by Vercel, but the currently deployed YTDB JavaScript can read them. Keep this deployment free
of analytics and third-party scripts, protect the GitHub and Vercel accounts with strong 2FA,
and use least-privilege PostgreSQL roles. A compromised UI deployment could act with the same
database permissions as the user while a bridge session is active.
