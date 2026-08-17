import 'package:flutter/material.dart';

import '../models/patient_profile.dart';
import '../services/clinic_profile_service.dart';
import '../services/notification_service.dart';
import '../services/identity_service.dart';
import '../services/storage_service.dart';
import '../services/upload_service.dart';
import '../widgets/brand_identity.dart';
import 'consent_screen.dart';
import 'daily_symptom_screen.dart';
import 'enrolment_screen.dart';
import 'home_screen.dart';
import 'privacy_screen.dart';
import 'startup_blocked_screen.dart';

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
    PatientProfile? profile = await StorageService.loadProfile();
    final storedProfile = profile;
    final consentAccepted = await StorageService.hasAcceptedConsent(
      policyVersion: PrivacyScreen.policyVersion,
    );
    final enrolled =
        storedProfile != null && await IdentityService.hasAccessToken();
    MobileConfiguration? mobileConfiguration;
    try {
      mobileConfiguration =
          await ClinicProfileService.fetchMobileConfiguration();
      if (mobileConfiguration.updateRequired) {
        if (!mounted) return;
        _replace(
          RequiredUpdateScreen(
            googlePlayUrl: mobileConfiguration.googlePlayUrl,
            appStoreUrl: mobileConfiguration.appStoreUrl,
          ),
        );
        return;
      }
    } on ClinicProfileException catch (error) {
      if (error.failure == ClinicProfileFailure.updateRequired) {
        if (!mounted) return;
        _replace(
          RequiredUpdateScreen(
            googlePlayUrl: error.googlePlayUrl,
            appStoreUrl: error.appStoreUrl,
          ),
        );
        return;
      }
      // An already-synchronised profile remains usable offline. Every
      // authenticated backend request still independently enforces updates.
    }

    var completedToday = false;
    if (storedProfile != null && consentAccepted && enrolled) {
      var activeProfile = storedProfile;
      try {
        activeProfile = await ClinicProfileService.fetchAssignedProfile(
          activeProfile,
        );
        await StorageService.saveProfile(activeProfile);
        profile = activeProfile;
      } on ClinicProfileException catch (error) {
        if (!mounted) return;
        switch (error.failure) {
          case ClinicProfileFailure.updateRequired:
            _replace(
              RequiredUpdateScreen(
                googlePlayUrl: error.googlePlayUrl,
                appStoreUrl: error.appStoreUrl,
              ),
            );
            return;
          case ClinicProfileFailure.enrolmentRequired:
            _replace(EnrolmentScreen(existingProfile: activeProfile));
            return;
          case ClinicProfileFailure.profileNotConfigured:
          case ClinicProfileFailure.invalidResponse:
            _replace(
              ClinicSetupRequiredScreen(
                profile: activeProfile,
                message: error.patientMessage,
                onRetry: (_) => _retryStartup(),
              ),
            );
            return;
          case ClinicProfileFailure.networkUnavailable:
            if (!activeProfile.isClinicManaged) {
              _replace(
                ClinicSetupRequiredScreen(
                  profile: activeProfile,
                  message:
                      'Connect to the internet so this phone can receive the clinic-assigned profile.',
                  onRetry: (_) => _retryStartup(),
                ),
              );
              return;
            }
        }
      }
      completedToday = await StorageService.hasSubmittedToday();
      try {
        await NotificationService.scheduleDailyReminder(
          hour: activeProfile.reminderTime.hour,
          minute: activeProfile.reminderTime.minute,
          skipToday: completedToday,
        );
      } catch (_) {
        // A notification failure must not prevent access to the diary.
      }
      await UploadService.retryPendingUploads();
    }
    if (!mounted) return;

    _replace(
      profile == null
          ? const ConsentScreen()
          : !consentAccepted
          ? ConsentScreen(existingProfile: profile)
          : !enrolled
          ? EnrolmentScreen(existingProfile: profile)
          : widget.openCheckIn && !completedToday
          ? DailySymptomScreen(profile: profile)
          : HomeScreen(profile: profile),
    );
  }

  void _replace(Widget screen) {
    Navigator.pushReplacement(
      context,
      MaterialPageRoute(builder: (_) => screen),
    );
  }

  void _retryStartup() {
    Navigator.pushReplacement(
      context,
      MaterialPageRoute(
        builder: (_) => StartupScreen(openCheckIn: widget.openCheckIn),
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
            const Padding(
              padding: EdgeInsets.symmetric(horizontal: 28),
              child: BrandBanner(),
            ),
            const SizedBox(height: 28),
            const CircularProgressIndicator(),
          ],
        ),
      ),
    );
  }
}
