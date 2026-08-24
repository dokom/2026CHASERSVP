# Deploying gala2026.chaselab.org

The portal runs as its own TLS origin on this machine and sits behind
Cloudflare. Two processes, both started from this directory:

| Process | Command | Listens on |
|---|---|---|
| MongoDB (single-node replica set) | `npm run db:start` | 127.0.0.1:27018 |
| Next.js origin server (HTTPS) | `npm run build && npm run serve` | 0.0.0.0:443 |

`npm run serve` is `scripts/serve.mjs`: a plain Node HTTPS server wrapping the
production Next.js app with the certificate in `ssl/`. It refuses to start
without a build or without the certificate, and it never listens on port 80
(that port belongs to Windows on this host; Cloudflare handles the redirect).

## Topology

```
browser ──TLS (Cloudflare edge cert)──▶ Cloudflare ──TLS (Origin CA cert)──▶ this host :443
```

`ssl/cert.pem` is a **Cloudflare Origin CA** certificate for `*.chaselab.org`
(valid until 2041). Browsers do not trust it directly — only Cloudflare's
edge does — so the site is reachable **only** through the Cloudflare proxy.
That is by design: the origin cannot be hit directly by IP, and Cloudflare's
edge does TLS termination, HTTP→HTTPS, and DDoS filtering for free.

`ssl/` is gitignored. The private key must never be committed.

## One-time setup

### 1. Cloudflare (dashboard, zone `chaselab.org`)

1. **DNS** → add an `A` record: name `gala2026`, content = this host's public
   IPv4, proxy status **Proxied** (orange cloud).
2. **SSL/TLS → Overview** → encryption mode **Full (strict)**. The Origin CA
   certificate satisfies "strict"; "Flexible" would send plain HTTP to an
   origin that only speaks HTTPS and fail.
3. **SSL/TLS → Edge Certificates** → **Always Use HTTPS**: On. (Optionally
   HSTS — the app already sends `Strict-Transport-Security` itself.)

### 2. Network path to this machine

- **Router**: forward external TCP 443 to this machine's LAN IP, port 443.
- **Windows Defender Firewall**: allow inbound TCP 443 for `node.exe`. The
  first `npm run serve` normally pops the "allow access" dialog; approving it
  needs an administrator. Without admin, ask whoever manages the machine to run:

  ```powershell
  netsh advfirewall firewall add rule name="Gala origin 443" dir=in action=allow protocol=TCP localport=443
  ```

- Optionally restrict inbound 443 to Cloudflare's IP ranges
  (https://www.cloudflare.com/ips/) so nothing but the edge can reach the origin.

### 3. Environment

`.env` (gitignored) holds the shared configuration; `.env.production` (also
gitignored) overrides `APP_URL` with the public origin. Both are already in
place. Before real guests are invited, in `.env`:

- `ADMIN_SEED_EMAIL` / `ADMIN_SEED_PASSWORD` — currently the placeholder
  owner `owner@example.com`. Set your real address and a strong password,
  run `npm run db:seed` (it creates the new owner if that email does not
  exist yet), sign in, then delete `owner@example.com` from **Admin → Users**.
- `SESSION_SECRET` — already rotated to a fresh 64-character random value.
  Do not change it once invitations exist: it is also the key that seals the
  invitation tokens, and changing it breaks every link already sent.

### 4. Build and run

```powershell
npm ci
npm run db:start        # terminal 1, stays open
npm run db:push         # once, or after any schema change
npm run db:seed         # once
npm run build           # after every code change
npm run serve           # terminal 2, stays open
```

Check from another machine on the LAN before touching DNS:

```powershell
curl -k --resolve gala2026.chaselab.org:443:<LAN-IP> https://gala2026.chaselab.org/admin/login -o NUL -w "%{http_code}"
```

`-k` is needed because the Origin CA certificate is not in your trust store;
`200` means the origin is serving. Once the DNS record is proxied, a normal
browser visit to https://gala2026.chaselab.org must show a padlock (that one
is Cloudflare's certificate) and the sign-in page.

### 5. Keep it running across reboots (no admin needed)

Windows Task Scheduler runs per-user tasks at logon without elevation. From a
PowerShell prompt **in this directory**:

```powershell
$here = (Get-Location).Path
schtasks /Create /F /SC ONLOGON /TN "Gala\MongoDB" /TR "cmd /c cd /d `"$here`" && npm run db:start"
schtasks /Create /F /SC ONLOGON /TN "Gala\Origin"  /TR "cmd /c cd /d `"$here`" && timeout /t 15 && npm run serve"
```

The 15-second delay gives MongoDB time to elect its primary before the app
connects. Remove with `schtasks /Delete /TN "Gala\Origin" /F` (and MongoDB).
The machine must stay logged in (lock the screen; do not sign out) and must
not sleep — **Settings → System → Power** → never sleep when plugged in.

## Updating the site

```powershell
git pull
npm ci
npm run db:push         # only if prisma/schema.prisma changed
npm run build
# stop the running `npm run serve` (Ctrl+C in its window, or end the task), then:
npm run serve
```

There is a few seconds of downtime while the new server starts. Cloudflare
will show its own 52x page during that window.

## Before the first invitation goes out

- [ ] Owner account is a real address, `owner@example.com` deleted.
- [ ] **Admin → Event**: name, date/time, timezone, venue, address, dress code,
      RSVP deadline, agenda, meal options, floorplan image, table markers.
      The seeded values are placeholders ("1 Placeholder Avenue", "Wear
      whatever").
- [ ] **Admin → Users**: add door staff (STAFF role) with their own logins.
- [ ] **Admin → Invites → Import** the guest list; every link and QR code is
      minted against `APP_URL`, so import only after DNS is live.
- [ ] Open one invitation link on a phone over mobile data (not the LAN).
- [ ] Scan its QR from **Admin → Check-in** on a second phone.

## What is deliberately not here

- No HTTP listener and no automatic HTTP→HTTPS redirect at the origin
  (Cloudflare does it; port 80 is taken by Windows).
- No process supervisor with restart-on-crash. Task Scheduler restarts both
  processes at logon only. If the origin ever crashes mid-event, re-run
  `npm run serve`.
