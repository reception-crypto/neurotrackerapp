import 'package:flutter/material.dart';

import '../models/patient_profile.dart';
import '../services/identity_service.dart';
import '../services/storage_service.dart';
import '../widgets/brand_identity.dart';
import 'enrolment_screen.dart';
import 'privacy_screen.dart';
import 'startup_screen.dart';

class ConsentScreen extends StatefulWidget {
  final PatientProfile? existingProfile;

  const ConsentScreen({super.key, this.existingProfile});

  @override
  State<ConsentScreen> createState() => _ConsentScreenState();
}

class _ConsentScreenState extends State<ConsentScreen> {
  static const String policyVersion = PrivacyScreen.policyVersion;
  bool consented = false;

  Future<void> _continue() async {
    await StorageService.recordConsent(policyVersion: policyVersion);
    if (!mounted) return;
    final existing = widget.existingProfile;
    if (existing != null && await IdentityService.hasAccessToken()) {
      if (!mounted) return;
      Navigator.pushAndRemoveUntil(
        context,
        MaterialPageRoute(builder: (_) => const StartupScreen()),
        (_) => false,
      );
      return;
    }
    if (!mounted) return;
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => EnrolmentScreen(existingProfile: existing),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const BrandAppBarTitle()),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(24, 24, 24, 32),
          children: [
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Privacy and Consent',
                  style: Theme.of(context).textTheme.headlineMedium,
                ),
                const SizedBox(height: 20),
                Text(
                  'Dr Pascoe or authorised clinic staff assign your name, neurological condition, and symptoms. The app records that profile, your daily symptom scores, and your overall wellness score. This information is intended to assist your clinical care. It is not diagnostic and does not replace medical advice.',
                  style: Theme.of(context).textTheme.bodyLarge,
                ),
                const SizedBox(height: 20),
                Text(
                  'Your entries are stored on this device and sent to Pascoe Neurology for clinical monitoring. Authorised clinic staff may review them as part of your care. The app is not continuously monitored and must not be used for emergencies.',
                  style: Theme.of(context).textTheme.bodyLarge,
                ),
                const SizedBox(height: 20),
                Text(
                  'You may stop using the app at any time. Removing local data does not delete information already received by the clinic. Contact the clinic to ask about access, correction, retention or deletion of clinic-held information.',
                  style: Theme.of(context).textTheme.bodyLarge,
                ),
                const SizedBox(height: 20),
                Text(
                  'This app is not a medical device and does not diagnose, treat, cure, or prevent any medical condition. It is not continuously monitored. In an emergency, contact local emergency services (000 in Australia).',
                  style: Theme.of(context).textTheme.bodyLarge,
                ),
                const SizedBox(height: 12),
                Align(
                  alignment: Alignment.centerLeft,
                  child: TextButton.icon(
                    icon: const Icon(Icons.privacy_tip_outlined),
                    label: const Text('Read privacy and app information'),
                    onPressed: () => Navigator.push(
                      context,
                      MaterialPageRoute(builder: (_) => const PrivacyScreen()),
                    ),
                  ),
                ),
                const SizedBox(height: 32),
                CheckboxListTile(
                  value: consented,
                  onChanged: (value) =>
                      setState(() => consented = value ?? false),
                  title: const Text('I consent'),
                  controlAffinity: ListTileControlAffinity.leading,
                ),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton(
                    onPressed: consented ? _continue : null,
                    child: const Text('Continue'),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
