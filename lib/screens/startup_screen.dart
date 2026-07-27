import 'package:flutter/material.dart';

import '../app_identity.dart';
import '../models/patient_profile.dart';
import '../services/notification_service.dart';
import '../services/identity_service.dart';
import '../services/storage_service.dart';
import '../services/upload_service.dart';
import 'consent_screen.dart';
import 'daily_symptom_screen.dart';
import 'enrolment_screen.dart';
import 'home_screen.dart';
import 'privacy_screen.dart';

class StartupScreen extends StatefulWidget {
  final bool openCheckIn;

  const StartupScreen({super.key, this.openCheckIn = false});

  @override
  State<StartupScreen> createState() => _StartupScreenState();
}

class _StartupScreenState extends State<StartupScreen> {
  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final PatientProfile? profile = await StorageService.loadProfile();
    final consentAccepted = await StorageService.hasAcceptedConsent(
      policyVersion: PrivacyScreen.policyVersion,
    );
    final enrolled = profile != null && await IdentityService.hasAccessToken();
    var completedToday = false;
    if (profile != null && consentAccepted && enrolled) {
      completedToday = await StorageService.hasSubmittedToday();
      try {
        await NotificationService.scheduleDailyReminder(
          hour: profile.reminderTime.hour,
          minute: profile.reminderTime.minute,
          skipToday: completedToday,
        );
      } catch (_) {
        // A notification failure must not prevent access to the diary.
      }
      await UploadService.retryPendingUploads();
    }
    if (!mounted) return;

    Navigator.pushReplacement(
      context,
      MaterialPageRoute(
        builder: (_) => profile == null
            ? const ConsentScreen()
            : !consentAccepted
            ? ConsentScreen(existingProfile: profile)
            : !enrolled
            ? EnrolmentScreen(existingProfile: profile)
            : widget.openCheckIn && !completedToday
            ? DailySymptomScreen(profile: profile)
            : HomeScreen(profile: profile),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Image.asset('assets/icon/app_icon.png', width: 112, height: 112),
            const SizedBox(height: 18),
            Text(
              appDisplayName,
              style: Theme.of(context).textTheme.headlineMedium,
            ),
            const SizedBox(height: 22),
            const CircularProgressIndicator(),
          ],
        ),
      ),
    );
  }
}
