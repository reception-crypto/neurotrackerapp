import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../app_identity.dart';
import '../models/patient_profile.dart';

class RequiredUpdateScreen extends StatelessWidget {
  final String googlePlayUrl;
  final String appStoreUrl;

  const RequiredUpdateScreen({
    super.key,
    this.googlePlayUrl = '',
    this.appStoreUrl = '',
  });

  Future<void> _copy(
    BuildContext context,
    String value,
    String storeName,
  ) async {
    await Clipboard.setData(ClipboardData(text: value));
    if (!context.mounted) return;
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text('$storeName link copied.')));
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      child: Scaffold(
        appBar: AppBar(
          automaticallyImplyLeading: false,
          title: const Text(appShortName),
        ),
        body: SafeArea(
          child: ListView(
            padding: const EdgeInsets.all(24),
            children: [
              const Icon(Icons.system_update, size: 72),
              const SizedBox(height: 24),
              Text(
                'Update required',
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.headlineMedium,
              ),
              const SizedBox(height: 16),
              const Text(
                'You must update NeuroSol Symptom Diary to the newest version before viewing your clinic profile or recording another check-in.',
                textAlign: TextAlign.center,
              ),
              if (googlePlayUrl.isNotEmpty) ...[
                const SizedBox(height: 24),
                FilledButton.icon(
                  onPressed: () => _copy(context, googlePlayUrl, 'Google Play'),
                  icon: const Icon(Icons.copy),
                  label: const Text('Copy Google Play link'),
                ),
              ],
              if (appStoreUrl.isNotEmpty) ...[
                const SizedBox(height: 12),
                FilledButton.icon(
                  onPressed: () => _copy(context, appStoreUrl, 'App Store'),
                  icon: const Icon(Icons.copy),
                  label: const Text('Copy App Store link'),
                ),
              ],
              const SizedBox(height: 20),
              const Text(
                'If the newest version is not yet visible in the store, wait a short time and check again. Contact the clinic if you need help.',
                textAlign: TextAlign.center,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class ClinicSetupRequiredScreen extends StatelessWidget {
  final PatientProfile profile;
  final String message;
  final void Function(BuildContext context) onRetry;

  const ClinicSetupRequiredScreen({
    super.key,
    required this.profile,
    required this.message,
    required this.onRetry,
  });

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      child: Scaffold(
        appBar: AppBar(
          automaticallyImplyLeading: false,
          title: const Text(appShortName),
        ),
        body: SafeArea(
          child: ListView(
            padding: const EdgeInsets.all(24),
            children: [
              const Icon(Icons.medical_services_outlined, size: 72),
              const SizedBox(height: 24),
              Text(
                'Clinic setup required',
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.headlineMedium,
              ),
              const SizedBox(height: 16),
              Text(message, textAlign: TextAlign.center),
              const SizedBox(height: 18),
              SelectableText(
                'Support ID: ${profile.supportId}',
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.titleMedium,
              ),
              const SizedBox(height: 24),
              FilledButton.icon(
                onPressed: () => onRetry(context),
                icon: const Icon(Icons.refresh),
                label: const Text('Try again'),
              ),
              const SizedBox(height: 16),
              const Text(
                'Dr Pascoe or clinic staff must assign your disorders and symptoms. Patients cannot change these fields in the app.',
                textAlign: TextAlign.center,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
