# NeuroTracker Windows HTTPS deployment

Public address:

```text
https://tracker.melindapascoeneurology.com
```

## 1. DNS

In Wix DNS, add an `A` record:

```text
Host:  tracker
Value: 117.20.4.91
```

Do not alter the root-domain or `www` records used by the Wix website.

Verify from a computer outside the server:

```powershell
Resolve-DnsName tracker.melindapascoeneurology.com -Type A
```

Continue only when it returns `117.20.4.91`.

## 2. Check ports before installing Caddy

Run as an administrator on the terminal server:

```powershell
Get-NetTCPConnection -State Listen -LocalPort 80,443 -ErrorAction SilentlyContinue |
  Select-Object LocalAddress, LocalPort, OwningProcess
```

If either port is already occupied, identify the process before changing
anything:

```powershell
Get-Process -Id THE_PROCESS_ID
```

Do not stop an existing IIS, RD Gateway or other production listener merely to
make room for Caddy. In that situation, configure the existing HTTPS service as
the reverse proxy instead.

## 3. Backend configuration

Copy `backend/.env.example` to `backend/.env` and replace every placeholder.
Production uses:

```text
HOST=127.0.0.1
PORT=3000
NODE_ENV=production
```

This makes Node reachable only from the server itself. Confirm it locally:

```powershell
Invoke-RestMethod http://127.0.0.1:3000/health
```

Port 3000 must not have a public inbound firewall rule.

## 4. Caddy

Download the Windows executable from the official Caddy download page and
place it in a dedicated directory such as `C:\Caddy`. Copy the repository's
`deploy\Caddyfile` beside it.

Validate the configuration:

```powershell
cd C:\Caddy
.\caddy.exe validate --config .\Caddyfile
```

For an initial foreground test:

```powershell
.\caddy.exe run --config .\Caddyfile
```

Caddy obtains and renews the public certificate automatically once DNS points
to the server and inbound TCP ports 80 and 443 reach Caddy.

## 5. Firewall

Allow inbound TCP 80 and 443 only. Keep port 3000 closed publicly. The hosting
provider may have an additional network firewall outside Windows which must be
updated separately.

## 6. External verification

From a different internet connection:

```powershell
Invoke-RestMethod https://tracker.melindapascoeneurology.com/health
```

Expected response:

```json
{"ok":true,"storage":"csv"}
```

Also confirm that this fails externally:

```text
http://117.20.4.91:3000/health
```

Only after these checks pass should a patient APK be built against the HTTPS
address.
