# NeuroSol Windows HTTPS deployment

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

## 3. Back up the existing service

Before replacing backend source, take a timestamped backup of the current
production `.env` and data directory. The identity store and symptom
CSV must subsequently be backed up and restored together.

Do not copy production clinical data into the Git repository or a release
bundle.

## 4. Backend configuration

Copy `backend/.env.example` to `backend/.env` and replace every placeholder.
Production uses:

```text
HOST=127.0.0.1
PORT=3000
NODE_ENV=production
APP_TIME_ZONE=Australia/Brisbane
IDENTITY_SECRET=REPLACE_WITH_AT_LEAST_32_RANDOM_CHARACTERS
ADMIN_USER=admin
ADMIN_PASSWORD=REPLACE_WITH_A_LONG_UNIQUE_PASSWORD
DATA_DIR=C:\ProgramData\NeuroSol\data
LATEST_MOBILE_BUILD=7
MIN_SUPPORTED_MOBILE_BUILD=7
ENABLE_CUSTOM_DISORDERS=false
ENABLE_INDEPENDENT_PROFILES=false
PUBLIC_BASE_URL=https://tracker.melindapascoeneurology.com
GOOGLE_PLAY_URL=https://play.google.com/store/apps/details?id=au.com.pascoeneurology.neurosol
```

Build 7 is publicly available and remains supported during the Build 8
rollout. Keep `MIN_SUPPORTED_MOBILE_BUILD=7`. Deploy the Build 8-compatible
backend with `LATEST_MOBILE_BUILD=7`, `ENABLE_CUSTOM_DISORDERS=false`, and
`ENABLE_INDEPENDENT_PROFILES=false` before either Build 8 app is released.

Generate a strong identity secret in PowerShell, save it in the clinic's
password manager, and paste it into `.env`:

```powershell
$Bytes = New-Object byte[] 48
$Rng = [Security.Cryptography.RandomNumberGenerator]::Create()
$Rng.GetBytes($Bytes)
[Convert]::ToBase64String($Bytes)
$Rng.Dispose()
```

Do not reuse `ADMIN_PASSWORD`, a signing password, or the former mobile API
key. Losing or changing `IDENTITY_SECRET` invalidates issued codes and enrolled
device tokens.

This makes Node reachable only from the server itself. Confirm it locally:

```powershell
cd C:\Projects\neurotrackerapp\backend
npm ci
npm test
npm start
Invoke-RestMethod http://127.0.0.1:3000/health
```

Port 3000 must not have a public inbound firewall rule.

Open `http://127.0.0.1:3000/admin/enrolments`, create a complete synthetic
clinic profile and code, enrol the clinic test phone, submit one check-in, and
confirm:

- the second distinct check-in for that PatientId/date is rejected;
- an exact network retry does not create duplicate rows;
- the portal groups by PatientId/support ID and displays the clinic name;
- profile edits synchronise to the Build 7 phone;
- revoking devices prevents further uploads.

## 5. Caddy

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

## 6. Firewall

Allow inbound TCP 80 and 443 only. Keep port 3000 closed publicly. The hosting
provider may have an additional network firewall outside Windows which must be
updated separately.

## 7. External verification

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

## 8. Build 7 compatibility during the Build 8 rollout

Deploy backend `0.9.0` before distributing Build 8. Initially set:

```env
LATEST_MOBILE_BUILD=7
MIN_SUPPORTED_MOBILE_BUILD=7
ENABLE_CUSTOM_DISORDERS=false
ENABLE_INDEPENDENT_PROFILES=false
```

Build 7 payloads omit `schemaVersion`; the backend interprets them as schema 1
and maps their validated labels into canonical IDs. Keep PatientId and
ProfileRevision unchanged. Do not enable custom definitions or independent
profiles until Build 8 is downloadable from both stores, and do not raise the
minimum build during this compatibility window.

## 9. Backup and access control

Apply Windows ACLs so only the backend service account and authorised
administrators can read:

- the production `.env`;
- `symptom_entries.csv`;
- `identity_store.json`;
- automatic migration backups and operational backups.

Back up `symptom_entries.csv` and `identity_store.json` as one recovery set,
and perform a restore test before the clinic rollout.
