import 'package:flutter/material.dart';

import '../theme/app_theme.dart';

class PrivacyScreen extends StatelessWidget {
  const PrivacyScreen({super.key});

  static const String policyVersion = '2026-07-31';

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Privacy and App Information')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 20, 20, 32),
        children: const [
          _PolicySection(
            title: 'Purpose of the app',
            body:
                'NeuroSol Symptom Diary allows patients to record clinic-assigned neurological symptoms and an overall wellness score for review by Pascoe Neurology as part of their clinical care.',
          ),
          _PolicySection(
            title: 'Information collected',
            body:
                'The app receives your name, neurological condition, and selected symptoms from the clinic. It records that assigned profile, symptom scores, wellness score, check-in date and time, a clinic-issued patient identifier, and a protected device credential used to associate submissions with the correct clinic record and prevent duplicates.',
          ),
          _PolicySection(
            title: 'Storage and transmission',
            body:
                'Your clinic-assigned profile and check-in history are stored on this device. The device credential is kept in protected operating-system storage. Profile updates and check-ins are transmitted over an encrypted connection to the clinic system. If a transmission fails, the app retains the pending check-in on this device and retries later.',
          ),
          _PolicySection(
            title: 'How information is used',
            body:
                'Information submitted through the app may be reviewed by authorised clinic staff for clinical monitoring, care administration, troubleshooting, security, and record-keeping. It is not sold or used for advertising.',
          ),
          _PolicySection(
            title: 'Access, correction and deletion',
            body:
                'Resetting the app removes its locally stored profile, device enrolment, and check-in history, but does not delete information already received by the clinic. A new one-time code is required to enrol again. Contact the clinic to request access to, correction of, or deletion of clinic-held information, subject to applicable health-record retention obligations.',
          ),
          _PolicySection(
            title: 'Important medical information',
            body:
                'This app is not a medical device and does not diagnose, treat, cure, or prevent any medical condition. It does not replace professional medical advice and is not continuously monitored. Do not use it for urgent or emergency assistance. In an emergency, call 000.',
          ),
          _PolicySection(
            title: 'Contact',
            body:
                'For privacy questions, support, or requests concerning clinic-held information, contact reception@pascoeneurology.com.',
          ),
          Text(
            'Policy version: $policyVersion',
            style: TextStyle(color: AppTheme.secondaryText),
          ),
        ],
      ),
    );
  }
}

class _PolicySection extends StatelessWidget {
  final String title;
  final String body;

  const _PolicySection({required this.title, required this.body});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 8),
          Text(body, style: Theme.of(context).textTheme.bodyLarge),
        ],
      ),
    );
  }
}
