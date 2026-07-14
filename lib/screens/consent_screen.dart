import 'package:flutter/material.dart';

import 'profile_screen.dart';

class ConsentScreen extends StatefulWidget {
  const ConsentScreen({super.key});

  @override
  State<ConsentScreen> createState() => _ConsentScreenState();
}

class _ConsentScreenState extends State<ConsentScreen> {
  bool consented = false;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('NeuroTracker')),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
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
              'By continuing, you consent to this information being collected and stored for clinical monitoring purposes.',
              style: Theme.of(context).textTheme.bodyLarge,
            ),
            const Spacer(),
            CheckboxListTile(
              value: consented,
              onChanged: (value) => setState(() => consented = value ?? false),
              title: const Text('I consent'),
              controlAffinity: ListTileControlAffinity.leading,
            ),
            SafeArea(
              minimum: const EdgeInsets.only(bottom: 20),
              child: SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: consented
                      ? () => Navigator.push(
                            context,
                            MaterialPageRoute(builder: (_) => const ProfileScreen()),
                          )
                      : null,
                  child: const Text('Continue'),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
