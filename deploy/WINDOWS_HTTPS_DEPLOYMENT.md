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
production `.env` and data directory. The Build 6 identity store and symptom
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
```

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

Open `http://127.0.0.1:3000/admin/enrolments`, create a code for a synthetic
test identity, enrol the clinic test phone, submit one check-in, and confirm:

- the second distinct check-in for that PatientId/date is rejected;
- an exact network retry does not create duplicate rows;
- the portal groups by support ID and displays the latest name;
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

## 8. Build 5 migration and Build 6 rollout

Deploy and verify the Build 6 backend before distributing the Build 6 app.
Existing Build 5 phones cannot upload after the backend change until they are
upgraded and enrolled.

For an existing patient, find their current PatientId in the portal and issue
**New device code** against that same identity. Do not create a new patient
identity, or their historical and future data will be split.

## 9. Backup and access control

Apply Windows ACLs so only the backend service account and authorised
administrators can read:

- the production `.env`;
- `symptom_entries.csv`;
- `identity_store.json`;
- automatic migration backups and operational backups.

Back up `symptom_entries.csv` and `identity_store.json` as one recovery set,
and perform a restore test before the clinic rollout.
