# NeuroSol clinic backend

Node/Express backend for canonical disorder definitions, staff-managed patient
profiles, secure mobile enrolment, symptom submission, CSV storage, clinician
review, population analytics, deletion safeguards, and PDF reports.

## Configure and verify

```cmd
cd C:\Projects\neurotrackerapp\backend
npm ci
copy .env.example .env
npm test
npm start
```

Production must use:

- a stable random `IDENTITY_SECRET` of at least 32 characters;
- a unique `ADMIN_PASSWORD` of at least 16 characters;
- `HOST=127.0.0.1`, exposed only through the clinic HTTPS reverse proxy;
- `DATA_DIR` outside the source directory where practical;
- `LATEST_MOBILE_BUILD=7` before Build 8 is released, then `8`;
- `MIN_SUPPORTED_MOBILE_BUILD=7` throughout the Build 8 rollout;
- `ENABLE_CUSTOM_DISORDERS=false` until Build 8 is available from both stores.

Do not replace the existing production `IDENTITY_SECRET`: doing so invalidates
every device credential and unused enrolment code.

## Create and maintain a patient

1. Open `/admin/enrolments`.
2. Enter the clinic display name.
3. Select a primary disorder and exactly three symptoms.
4. Optionally select a distinct second disorder and exactly three symptoms.
5. Choose **Save and create enrolment code**.
6. Copy the one-time HTTPS link or code and send it through the clinic’s
   existing communication system.

Codes expire after seven days and work once. Only an HMAC digest is stored.
Opening the HTTPS invitation page does not redeem the code and shows no patient
name or clinical details.

Use **Edit profile** for later clinical changes. The revision increments only
when disorders or symptoms change; a name-only correction keeps the same
clinical revision. Enrolled Build 7 phones fetch the latest profile.

## Build 8 custom disorders

Custom disorder definitions are managed at `/admin/disorders`. Staff must type
the exact clinical name twice. Case, whitespace, and dash variants of an
existing definition are rejected. After creation, profiles select the stable
canonical ID rather than retyping the name. Symptoms remain restricted to the
controlled NeuroSol symptom vocabulary.

Custom definitions are never hard-deleted. Archive a definition to remove it
from future profile assignments while retaining historical profiles, CSV rows,
and analytics. Correcting a custom name preserves its ID and creates a new
profile revision for every currently assigned patient. The previous revision
and previous submitted labels remain auditable.

The backend creates `disorder_catalog.json` with an audit log. On first Build 8
startup it also adds canonical disorder and symptom IDs to existing profiles
and CSV rows. The original `identity_store.json` and CSV are backed up before
either migration is committed. If an existing profile cannot be resolved, the
identity migration aborts without overwriting the source file.

Safe rollout order:

1. Deploy this backend with `LATEST_MOBILE_BUILD=7`,
   `MIN_SUPPORTED_MOBILE_BUILD=7`, and `ENABLE_CUSTOM_DISORDERS=false`.
2. Confirm health, existing Build 7 profile sync, submissions, portal reports,
   and migration backups.
3. Release Build 8 on Google Play and the App Store.
4. After both releases are downloadable, set `LATEST_MOBILE_BUILD=8` and then
   `ENABLE_CUSTOM_DISORDERS=true`. Keep
   `MIN_SUPPORTED_MOBILE_BUILD=7`.

Build 7 remains a supported production client. The mobile configuration route
advertises Build 7 as the latest compatible build to Build 7 because that app
treats `latestBuild` as a mandatory update. Build 8 clients see Build 8. This
prevents a nominal “latest” value from accidentally disabling the public Build
7 app.

A custom-profile code requires Build 8 and the
`X-NeuroSol-Disorders: canonical-v1` capability header. An older client receives
HTTP `426` without consuming the one-time code. Existing Build 7 patients using
built-in disorders continue normally. Do not assign a custom disorder to an
existing patient until the portal shows that patient’s active device has been
observed on Build 8. The profile editor enforces this: any active Build 7 or
unconfirmed device blocks a custom assignment. Revoke a genuinely obsolete
device rather than bypassing the safeguard.

For a reinstall or replacement phone, use **New device code** on the existing
Support ID. Do not create a second patient identity.

## Mobile version policy

The backend recognises the Build 7 protocol:

```text
X-NeuroSol-Build: 7
X-NeuroSol-Profile: clinic-managed-v1
```

Build 7 submissions have no payload `schemaVersion`; absence is interpreted as
schema 1. Their disorder and symptom labels are validated against the assigned
`ProfileRevision`, mapped to canonical IDs on the server, and retained with the
same `PatientId` and `ProfileRevision`.

Build 8 schema 2 requests additionally use:

```text
X-NeuroSol-Build: 8
X-NeuroSol-Profile: clinic-managed-v1
X-NeuroSol-Disorders: canonical-v1
```

Schema 2 payloads declare `schemaVersion: 2` and use canonical disorder and
symptom IDs. Missing schema-version data always follows the Build 7/schema 1
path, including when sent by a newer client. Unknown schema versions are
rejected.

Unsupported global requests receive HTTP `426` with `app_update_required`.
Production refuses to start if `MIN_SUPPORTED_MOBILE_BUILD` is anything other
than 7. A patient-specific profile containing a custom disorder may still
require Build 8 because Build 7 cannot represent it.

Build 7 submissions must exactly match the assigned profile revision. The
portal records the most recently observed app build and payload schema for each
active device. Review `/admin/disorders` and `/admin/enrolments` before any
future compatibility retirement; traffic observations never retire Build 7
automatically.

## Portal and runtime data

- Patient review: `/admin`
- Population analytics: `/admin/population`
- Profile and enrolment administration: `/admin/enrolments`
- Backed-up patient deletion: `/admin/patients`
- CSV export: `/admin/export.csv`
- Health: `/health`
- Mobile configuration: `/api/mobile-config`

PatientId is the patient grouping, filtering, daily uniqueness, and deletion
key. The clinic-stored name is only a display label. `DisorderId` and
`SymptomId` are the canonical clinical grouping keys; `Disorder` and `Symptom`
remain human-readable snapshots. `ProfileRevision`, `DisorderId`, and
`SymptomId` remain present, and `PayloadSchemaVersion` records whether the
accepted payload used the Build 7/schema 1 or Build 8/schema 2 contract.

The runtime directory contains `symptom_entries.csv`,
`identity_store.json`, `disorder_catalog.json`, migration backups, and deletion
backups. Protect all of them as clinical information and back up the CSV,
identity store, and disorder catalogue together.

## Google Play review

Reusable reviewer access remains restricted to a synthetic identity:

```env
REVIEW_ENROLMENT_CODE=<random 12-character code>
REVIEW_PATIENT_ID_PREFIX=pt-review-google-play
REVIEW_DISPLAY_NAME=Google Play Review
```

Each clean reviewer installation receives a separate synthetic PatientId and
the fixed synthetic Migraine profile. Never use real patient information.
