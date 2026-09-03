# Publishing YTDB

YTDB has two release surfaces that should be published in this order:

1. The `@theobourgeois/ytdb` npm package, which runs the authenticated local database bridge.
2. The Next.js UI, hosted at `https://ytdb.theobourgeois.com`.

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
