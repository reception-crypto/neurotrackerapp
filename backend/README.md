# NeuroSol clinic backend

Node/Express backend for staff-managed patient profiles, secure mobile
enrolment, symptom submission, CSV storage, clinician review, population
analytics, deletion safeguards, and PDF reports.

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
- `LATEST_MOBILE_BUILD=7`;
- `MIN_SUPPORTED_MOBILE_BUILD=7` after the Play release is available.

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

For a reinstall or replacement phone, use **New device code** on the existing
Support ID. Do not create a second patient identity.

## Mobile version policy

The backend recognises these headers:

```text
X-NeuroSol-Build: 7
X-NeuroSol-Profile: clinic-managed-v1
```

Unsupported requests receive HTTP `426` with `app_update_required`. The server
defaults the minimum to the latest build. During the short Play review window
only, explicitly set the minimum to 6; restore it to 7 immediately after Build
7 becomes available.

A clinic-managed code cannot be consumed by Build 6 even during that temporary
window. Build 7 submissions must exactly match the assigned profile revision.
Queued Build 6 records without a revision are migrated only if their records
exactly match the current clinic profile.

## Portal and runtime data

- Patient review: `/admin`
- Population analytics: `/admin/population`
- Profile and enrolment administration: `/admin/enrolments`
- Backed-up patient deletion: `/admin/patients`
- CSV export: `/admin/export.csv`
- Health: `/health`
- Mobile configuration: `/api/mobile-config`

PatientId is the grouping, filtering, daily uniqueness, and deletion key. The
clinic-stored name is only a display label. `ProfileRevision` is appended to
the CSV schema.

The runtime directory contains `symptom_entries.csv`,
`identity_store.json`, CSV migration backups, and deletion backups. Protect
all of them as clinical information and back up the CSV and identity store
together.

## Google Play review

Reusable reviewer access remains restricted to a synthetic identity:

```env
REVIEW_ENROLMENT_CODE=<random 12-character code>
REVIEW_PATIENT_ID_PREFIX=pt-review-google-play
REVIEW_DISPLAY_NAME=Google Play Review
```

Each clean reviewer installation receives a separate synthetic PatientId and
the fixed synthetic Migraine profile. Never use real patient information.
