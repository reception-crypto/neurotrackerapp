# NeuroSol Symptom Diary store release preparation

This is an operational submission draft, not legal advice. The clinic should
approve the final declarations and ensure they match the deployed service.

## Application identity

- Store name: NeuroSol Symptom Diary
- Android application ID: `au.com.pascoeneurology.neurosol`
- Apple bundle ID: `au.com.pascoeneurology.neurosol`
- Release version: `1.0.0+7`
- Category: Medical
- Support email: `reception@pascoeneurology.com`
- Privacy policy:
  `https://www.melindapascoeneurology.com/our-privacy-policy`
- Clinical support:
  `https://www.melindapascoeneurology.com/neurotracker-clinical-support`

## Store description

NeuroSol Symptom Diary helps participating Pascoe Neurology patients complete
a daily symptom and wellness check-in for review as part of their clinical
care. Dr Pascoe or authorised clinic staff assign each patient’s disorders and
symptoms before a one-time link or code securely connects the phone to the
intended clinic record. Patients may change their reminder time, but not the
clinic-assigned clinical profile. Entries remain on the device and are sent to
the clinic; failed transmissions remain pending and retry later.

The app is not continuously monitored and must not be used for urgent or
emergency assistance. It is not a medical device, does not diagnose, treat,
cure, or prevent a condition, and does not replace professional medical
advice. In an emergency, call 000.

## Google Play declarations to verify

- Data collected: name, clinic-assigned health profile, symptom and wellness
  scores, clinic-issued PatientId,
  per-device security credential, submission ID, check-in date/time, and
  profile revision.
- Purpose: app functionality, clinical monitoring, care administration,
  security, troubleshooting, duplicate prevention, and record-keeping.
- Data sharing: no sale or advertising use. Confirm whether hosting, backup,
  support, or other providers count as sharing under the current definitions.
- Encryption in transit: HTTPS.
- Deletion and access: patient contacts the clinic, subject to health-record
  retention obligations. Reset affects local data only.
- Access model: clinic-issued one-time enrolment; no public self-registration.
  Confirm the current account-creation/deletion interpretation in Play Console.
- Health apps declaration: select every applicable disease/condition
  management and healthcare service/management category.
- Medical-device status: not a medical device.
- Ads and tracking: none.

Because the app is enrolment-gated, Play App access instructions must include
the dedicated reusable synthetic reviewer credential configured for store
review. Normal patient codes remain one-time. Never use a real patient record
for review.

## Apple App Privacy answers to verify

- Contact Info / Name: linked to the user; app functionality.
- Health & Fitness / Health: linked to the user; app functionality.
- Identifiers / User ID: clinic PatientId linked to the user; app
  functionality, security, and duplicate prevention.
- Device credential: linked security/authentication information.
- Usage Data: check-in date/time linked to the user.
- Tracking: no.
- Third-party advertising: no.

## Build and review gates

Use [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) as the authoritative Build 7
gate. In particular, deploy and test the matching backend before uploading the
AAB, provide only synthetic review access, and do not release to real patients
until privacy, backup/restore, clinic enrolment, revocation, and incident
procedures are approved.
