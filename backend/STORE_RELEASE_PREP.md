# NeuroTracker store release preparation

This document is a submission draft, not legal advice. The clinic should approve
the final privacy wording and ensure it matches actual operational practices.

## Application identity

- Store name: NeuroTracker Clinical
- Android application ID: `au.com.pascoeneurology.neurotracker`
- Apple bundle ID: `au.com.pascoeneurology.neurotracker`
- Release version: `1.0.0+2`
- Category: Medical
- Support email: `reception@pascoeneurology.com`
- Public privacy policy URL: **TO BE PUBLISHED ON THE CLINIC WEBSITE**

## Short description

Record neurological symptoms and wellness for review by your treating clinic.

## Full description

NeuroTracker Clinical helps participating Pascoe Neurology patients complete a
simple daily symptom and wellness check-in. Patients select the neurological
condition and symptoms requested by their clinic, record symptom severity, and
submit an overall wellness score.

Entries are retained on the device and sent to the clinic for clinical
monitoring. If the clinic connection is temporarily unavailable, a pending
check-in remains on the device and can be retried later.

The app is not continuously monitored and must not be used for urgent or
emergency assistance.

NeuroTracker Clinical is not a medical device and does not diagnose, treat,
cure, or prevent any medical condition. It does not replace professional
medical advice. In an emergency, call 000.

## Draft Google Play Data safety answers

These answers must be checked against the Play Console definitions at the time
of submission.

- Data collected: name; health information; app-generated patient and
  submission identifiers; check-in date and time.
- Purpose: app functionality, clinical monitoring, care administration,
  security, troubleshooting, and record-keeping.
- Data sharing: no sale or advertising use. Confirm whether any infrastructure
  or support provider qualifies as a third party under Google's definitions.
- Processing: data is sent from the device to the clinic backend.
- Encryption in transit: yes, using the clinic HTTPS endpoint.
- Deletion requests: handled by contacting the clinic, subject to applicable
  health-record retention obligations.
- Account creation: none. A locally stored patient profile is not an online
  account.
- Health apps declaration: diseases and conditions management / healthcare
  services and management, subject to the final Play Console wording.
- Medical device status: not a medical device.

## Draft Apple App Privacy answers

These answers must be checked against App Store Connect definitions at the time
of submission.

- Contact Info: Name — linked to the user; used for app functionality.
- Health & Fitness: Health — linked to the user; used for app functionality.
- Identifiers: User ID or equivalent app-generated identifier — linked to the
  user; used for app functionality and duplicate prevention.
- Usage Data: check-in date and time — linked to the user; used for app
  functionality.
- Tracking: no.
- Third-party advertising: no.

## Assets still required

- Public HTML privacy-policy page on the clinic website.
- Support page on the clinic website.
- Android phone screenshots.
- iPhone screenshots captured from the signed TestFlight build.
- Google Play feature graphic.
- Final review and approval of all patient-facing wording.

## Build gates

- Run `dart format lib test`.
- Run `flutter analyze`.
- Run `flutter test`.
- Build the signed Android App Bundle with the production API URL and API key.
- Confirm the App Bundle contains version code 2 or higher.
- Build iOS on macOS after Apple Developer organisation enrolment.
- Test notification scheduling and notification-tap navigation on a physical
  Android device and physical iPhone.
- Test an offline submission followed by a successful retry.
- Confirm the production API endpoint and portal backup before public release.
