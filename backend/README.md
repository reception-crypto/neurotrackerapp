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
  This gate also prevents a Build 8-only custom symptom from being assigned to
  a patient profile during the compatibility rollout.
- `ENABLE_INDEPENDENT_PROFILES=false` during backend predeployment. Enable it
  only after Build 8 is downloadable from both stores.

Do not replace the existing production `IDENTITY_SECRET`: doing so invalidates
every device credential and unused enrolment code.

## Create and maintain a patient

While `ENABLE_INDEPENDENT_PROFILES=false`, the portal intentionally retains the
legacy Build 7 editor. The following workflow becomes active only after the
Build 8 mobile releases are live and the gate is enabled.

1. Open `/admin/enrolments`.
2. Enter the clinic display name.
3. Select one or more disorders from the controlled disorder list.
4. Select between one and six symptoms independently from the controlled
   symptom list. A symptom is rated once even when several disorders are
   selected.
5. Choose **Save and create enrolment code**.
6. Copy the one-time HTTPS link or code and send it through the clinic’s
   existing communication system.

Codes expire after seven days and work once. Only an HMAC digest is stored.
Opening the HTTPS invitation page does not redeem the code and shows no patient
name or clinical details.

Use **Edit profile** for later clinical changes. The revision increments only
when disorders or symptoms change; a name-only correction keeps the same
clinical revision. Converting a nested Build 7 profile to the independent model
creates a new schema-3 revision and retains every earlier revision unchanged.
The portal blocks that conversion while the patient still has an active device
that has not reported the Build 8 independent-profile capability.

## Build 8 disorder and symptom catalogue

Disorder definitions are managed at `/admin/disorders`; symptom definitions are
managed separately at `/admin/symptoms`. Schema-3 profiles can combine any
active disorders with any one to six active symptoms. There is no
symptom-to-disorder mapping in the new model. The former nested mappings remain
stored and interpreted only for Build 7 profiles and historical revisions.

Staff can also create a new symptom by typing its exact clinical name twice.
Case, whitespace, punctuation-normalised, and dash variants of existing names
are rejected. The new symptom receives an immutable, readable canonical ID
derived from its original approved name (for example, `Postural tremor`
becomes `postural-tremor`) and requires Build 8 when selected in a patient
profile. If two distinct names collapse to the same machine-safe slug, a short
uniqueness suffix is added. It immediately becomes an independent catalogue
choice; it is not nested under a disorder.

Custom symptoms and disorders are never hard-deleted. Archive them to prevent
future selection. Reactivation restores their previous stable ID and disorder
associations. Correcting a custom symptom name preserves its ID and creates a
new revision for currently assigned profiles that use it. Earlier profile
revisions and submitted display labels remain unchanged.

Custom definitions are never hard-deleted. Archive a definition to remove it
from future profile assignments while retaining historical profiles, CSV rows,
and analytics. Correcting a custom name preserves its ID and creates a new
profile revision for every currently assigned patient. The previous revision
and previous submitted labels remain auditable.

The active Migraine vocabulary includes both `Vertigo` and `Dizziness`.
`Visual aura` is retained as a historical-only canonical symptom so existing
Build 7 profile revisions and submissions remain valid, but it cannot be
selected for a new or edited profile.

The backend creates `disorder_catalog.json` with an audit log. Catalogue schema
2 adds custom symptoms and per-disorder symptom availability additively. A
schema-1 catalogue is validated and backed up before migration. Existing
custom disorders and audit events are retained. The identity and CSV migration
still preserves canonical disorder/symptom IDs and historical labels. If an
existing profile cannot be resolved, the identity migration aborts without
overwriting the source file.

Safe rollout order:

1. Deploy this backend with `LATEST_MOBILE_BUILD=7`,
   `MIN_SUPPORTED_MOBILE_BUILD=7`, `ENABLE_CUSTOM_DISORDERS=false`, and
   `ENABLE_INDEPENDENT_PROFILES=false`.
2. Confirm health, existing Build 7 profile sync, submissions, portal reports,
   and migration backups.
3. Release Build 8 on Google Play and the App Store.
4. After both releases are downloadable, set `LATEST_MOBILE_BUILD=8`, then
   enable `ENABLE_INDEPENDENT_PROFILES=true` and
   `ENABLE_CUSTOM_DISORDERS=true`. Keep `MIN_SUPPORTED_MOBILE_BUILD=7`.

Build 7 remains a supported production client. The mobile configuration route
advertises Build 7 as the latest compatible build to Build 7 because that app
treats `latestBuild` as a mandatory update. Build 8 clients see Build 8. This
prevents a nominal “latest” value from accidentally disabling the public Build
7 app.

A profile containing a custom disorder or custom symptom requires Build 8 and
the `X-NeuroSol-Disorders: canonical-v1` capability header. A schema-3 profile
also requires `X-NeuroSol-Profile-Model: independent-v1`. An older client
receives HTTP `426` without consuming the one-time code. Existing Build 7
patients continue normally. Do not convert an existing profile until every
active device for that patient has been observed with the required Build 8
capabilities. The profile editor enforces this. Revoke a genuinely obsolete
device rather than bypassing the safeguard.

For a reinstall or replacement phone, use **New device code** on the existing
Support ID. Do not create a second patient identity.

## Enrolment identity collision recovery

If several codes were accidentally issued from one patient edit form, stop the
backend service and preserve the entire data directory before doing anything
else. Set `ENROLMENT_INCIDENT_LOCKDOWN=true`, restart the backend, and confirm
`/health` reports `"enrolmentIncidentLockdown":true`. The lockdown leaves the
clinician portal available but returns HTTP 503 for mobile enrolment, profile
sync, and symptom uploads.

Open `/admin/enrolments/recovery`. For each affected person, enter the exact
original code sent to that person and the correct display name. The first
successful recovery quarantines the shared identity, invalidates all original
codes attached to it, and blocks all attached devices. For a previously used
code, the server matches the code redemption time to its device credential. A
single exact match is bridged only to that recovered PatientId so pending phone
entries can sync to the correct record after lockdown. Unmatched devices remain
blocked and are revoked when all original codes have been processed. Each code
is recovered into a distinct PatientId with its issue-time clinical profile
revision and a one-time replacement code. The server creates an identity-store
backup before every recovery.

Do not automatically reassign existing CSV submissions from the quarantined
identity: the current CSV schema cannot prove which device submitted an entry.
Keep those rows as incident evidence and reconcile them manually only with
independent clinical confirmation. Once every affected code has been recovered
and the replacement instructions are ready, set
`ENROLMENT_INCIDENT_LOCKDOWN=false`, restart, and confirm `/health` reports
`false`. An already-installed patient should reopen the app and wait until
Settings shows `Synced` before entering the replacement code from Settings.
That step retires the temporary recovery bridge and stores the new PatientId on
the phone.

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

Build 8 independent profiles use:

```text
X-NeuroSol-Build: 8
X-NeuroSol-Profile: clinic-managed-v1
X-NeuroSol-Disorders: canonical-v1
X-NeuroSol-Profile-Model: independent-v1
```

Schema 3 payloads declare `schemaVersion: 3` and contain between one and six
unique `Independent` symptom records. The records carry canonical symptom IDs
and no per-row disorder. The assigned profile’s disorder IDs and display-name
snapshots are stored once per row in the additive `ProfileDisorderIds` and
`ProfileDisorders` columns for filtering and auditability.

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
- Controlled disorder list: `/admin/disorders`
- Controlled symptom list: `/admin/symptoms`
- Backed-up patient deletion: `/admin/patients`
- CSV export: `/admin/export.csv`
- Health: `/health`
- Mobile configuration: `/api/mobile-config`

PatientId is the patient grouping, filtering, daily uniqueness, and deletion
key. The clinic-stored name is only a display label. `DisorderId` and
`SymptomId` are the canonical clinical grouping keys; `Disorder` and `Symptom`
remain human-readable snapshots for legacy rows. `ProfileRevision`,
`DisorderId`, and `SymptomId` remain present. `PayloadSchemaVersion` records
whether the accepted payload used schema 1, 2, or 3; schema-3 rows additionally
carry `ProfileDisorderIds` and `ProfileDisorders`.

The runtime directory contains `symptom_entries.csv`,
`identity_store.json`, `disorder_catalog.json`, migration backups, and deletion
backups. Protect all of them as clinical information and back up the CSV,
identity store, and disorder catalogue together. Catalogue edits are audited;
do not edit `disorder_catalog.json` by hand.

## Google Play review

Reusable reviewer access remains restricted to a synthetic identity:

```env
REVIEW_ENROLMENT_CODE=<random 12-character code>
REVIEW_PATIENT_ID_PREFIX=pt-review-google-play
REVIEW_DISPLAY_NAME=Google Play Review
```

Each clean reviewer installation receives a separate synthetic PatientId and
the fixed synthetic Migraine profile. Never use real patient information.
