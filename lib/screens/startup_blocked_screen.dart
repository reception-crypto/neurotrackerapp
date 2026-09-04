import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';

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

  ({String url, String storeName})? get _preferredStore {
    if (defaultTargetPlatform == TargetPlatform.iOS && appStoreUrl.isNotEmpty) {
      return (url: appStoreUrl, storeName: 'App Store');
    }
    if (defaultTargetPlatform == TargetPlatform.android &&
        googlePlayUrl.isNotEmpty) {
      return (url: googlePlayUrl, storeName: 'Google Play');
    }
    if (googlePlayUrl.isNotEmpty) {
      return (url: googlePlayUrl, storeName: 'Google Play');
    }
    if (appStoreUrl.isNotEmpty) {
      return (url: appStoreUrl, storeName: 'App Store');
    }
    return null;
  }

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

  Future<void> _openStore(BuildContext context) async {
    final store = _preferredStore;
    if (store == null) return;

    final uri = Uri.tryParse(store.url);
    if (uri != null) {
      try {
        final opened = await launchUrl(
          uri,
          mode: LaunchMode.externalApplication,
        );
        if (opened) return;
      } catch (_) {
        // Copying the URL below remains a usable fallback.
      }
    }

    if (!context.mounted) return;
    await _copy(context, store.url, store.storeName);
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          '${store.storeName} could not be opened automatically. The update link was copied instead.',
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final store = _preferredStore;

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
                'You must update NeuroSol Symptom Diary to a supported version before viewing your clinic profile or recording another check-in.',
                textAlign: TextAlign.center,
              ),
              if (store != null) ...[
                const SizedBox(height: 24),
                FilledButton.icon(
                  onPressed: () => _openStore(context),
                  icon: const Icon(Icons.open_in_new),
                  label: Text('Update NeuroSol in ${store.storeName}'),
                ),
                const SizedBox(height: 12),
                TextButton.icon(
                  onPressed: () => _copy(context, store.url, store.storeName),
                  icon: const Icon(Icons.copy),
                  label: const Text('Copy update link'),
                ),
              ],
              const SizedBox(height: 20),
              const Text(
                'If the required version is not yet visible in the store, check again later or contact the clinic for help.',
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
