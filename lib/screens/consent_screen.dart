import 'package:flutter/material.dart';

import '../services/storage_service.dart';
import 'profile_screen.dart';

class ConsentScreen extends StatefulWidget {
  const ConsentScreen({super.key});

  @override
  State<ConsentScreen> createState() => _ConsentScreenState();
}

class _ConsentScreenState extends State<ConsentScreen> {
  static const String policyVersion = '2026-07-17';
  bool consented = false;

  Future<void> _continue() async {
    await StorageService.recordConsent(policyVersion: policyVersion);
    if (!mounted) return;
    Navigator.push(
      context,
      MaterialPageRoute(builder: (_) => const ProfileScreen()),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('NeuroTracker')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(24, 24, 24, 32),
          children: [
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
            Text('Privacy and Consent', style: Theme.of(context).textTheme.headlineMedium),
            const SizedBox(height: 20),
            Text(
              'This app records your name, selected neurological condition, chosen symptoms, daily symptom scores, and overall wellness score. This information is intended to assist your clinical care. It is not diagnostic and does not replace medical advice.',
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
            const SizedBox(height: 32),
            CheckboxListTile(
              value: consented,
              onChanged: (value) => setState(() => consented = value ?? false),
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
