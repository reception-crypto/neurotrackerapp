# NeuroSol clinic backend

Node/Express backend for secure mobile enrolment, symptom submission, CSV
storage, clinician review, population analytics, and PDF reports.

## Configure and run

```cmd
cd C:\Projects\neurotrackerapp\backend
npm ci
copy .env.example .env
npm test
npm start
```

Production must set a random `IDENTITY_SECRET` of at least 32 characters and a
long unique `ADMIN_PASSWORD`. Build 6 does not accept the former shared mobile
API key. Bind Node to `127.0.0.1` and publish it only through the clinic HTTPS
reverse proxy.

## Enrol a patient

1. Open `/admin/enrolments` using the clinician portal credentials.
2. For a new patient, enter the display name and create a one-time code.
3. Give the code directly to the intended patient. It expires after seven days
   and can only be redeemed once.
4. For a reinstall or replacement phone, use **New device code** beside the
   existing support ID. This preserves the PatientId.
5. Use **Revoke devices** if a phone or credential may be compromised.

The plaintext code is displayed once. The server stores only an HMAC hash.
Mobile access tokens are also stored only as HMAC hashes.

## Portal

- Patient review: `/admin`
- Population analytics: `/admin/population`
- Enrolment administration: `/admin/enrolments`
- CSV export: `/admin/export.csv`
- Health check: `/health`

Patient charts, filters, population overlays, outlier summaries, and PDF
reports use PatientId as the grouping key. The latest submitted name is a
display label, not an identity key.

## Runtime data and backup

The configured `DATA_DIR` contains:

- `symptom_entries.csv`
- `identity_store.json`
- timestamped CSV migration backups

Back up and restore the CSV and identity store together. Protect the backup as
clinical information. The production `.env` and `IDENTITY_SECRET` require a
separate secure backup. None of these files belong in Git.

The server accepts an exact SubmissionId retry without adding rows, but rejects
a second distinct submission for the same PatientId and date with HTTP `409`
and code `daily_submission_exists`.
