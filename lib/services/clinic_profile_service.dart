import 'dart:convert';

import 'package:http/http.dart' as http;

import '../app_identity.dart';
import '../models/patient_profile.dart';
import 'api_config.dart';
import 'identity_service.dart';

enum ClinicProfileFailure {
  updateRequired,
  profileNotConfigured,
  enrolmentRequired,
  networkUnavailable,
  invalidResponse,
}

class ClinicProfileException implements Exception {
  final ClinicProfileFailure failure;
  final String patientMessage;
  final String googlePlayUrl;
  final String appStoreUrl;

  const ClinicProfileException(
    this.failure,
    this.patientMessage, {
    this.googlePlayUrl = '',
    this.appStoreUrl = '',
  });

  @override
  String toString() => patientMessage;
}

class MobileConfiguration {
  final int minimumBuild;
  final int latestBuild;
  final String googlePlayUrl;
  final String appStoreUrl;
  final bool canonicalDisorders;
  final bool independentProfileModel;
  final bool independentProfilesEnabled;
  final int maximumProfileSymptoms;
  final int preferredPayloadSchemaVersion;
  final bool patientDiary;
  final int maximumBackdateDays;

  const MobileConfiguration({
    required this.minimumBuild,
    required this.latestBuild,
    required this.googlePlayUrl,
    required this.appStoreUrl,
    this.canonicalDisorders = true,
    this.independentProfileModel = true,
    this.independentProfilesEnabled = false,
    this.maximumProfileSymptoms = 6,
    this.preferredPayloadSchemaVersion = 2,
    this.patientDiary = true,
    this.maximumBackdateDays = defaultMaximumBackdateDays,
  });

  bool get updateRequired =>
      appBuildNumber < minimumBuild || appBuildNumber < latestBuild;
}

class ClinicProfileService {
  ClinicProfileService._();

  static Map<String, dynamic> _jsonBody(http.Response response) {
    try {
      return Map<String, dynamic>.from(jsonDecode(response.body) as Map);
    } catch (_) {
      return const {};
    }
  }

  static ClinicProfileException _updateException(Map<String, dynamic> body) {
    return ClinicProfileException(
      ClinicProfileFailure.updateRequired,
      'Update NeuroSol Symptom Diary to the newest version to continue.',
      googlePlayUrl: (body['googlePlayUrl'] as String?)?.trim() ?? '',
      appStoreUrl: (body['appStoreUrl'] as String?)?.trim() ?? '',
    );
  }

  static Future<MobileConfiguration> fetchMobileConfiguration() async {
    if (IdentityService.usesInMemoryStorage) {
      return const MobileConfiguration(
        minimumBuild: appBuildNumber,
        latestBuild: appBuildNumber,
        googlePlayUrl: '',
        appStoreUrl: '',
        independentProfilesEnabled: true,
        preferredPayloadSchemaVersion: 3,
      );
    }
    if (ApiConfig.baseUrl.trim().isEmpty) {
      throw const ClinicProfileException(
        ClinicProfileFailure.invalidResponse,
        'The clinic connection is not configured in this app build.',
      );
    }
    final base = ApiConfig.baseUrl.replaceAll(RegExp(r'/+$'), '');
    try {
      final response = await http
          .get(
            Uri.parse('$base/api/mobile-config'),
            headers: IdentityService.mobileHeaders(),
          )
          .timeout(const Duration(seconds: 10));
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw const ClinicProfileException(
          ClinicProfileFailure.networkUnavailable,
          'The clinic could not be reached to verify this app version.',
        );
      }
      final body = _jsonBody(response);
      final minimumBuild = (body['minimumBuild'] as num?)?.toInt() ?? 0;
      final latestBuild = (body['latestBuild'] as num?)?.toInt() ?? 0;
      final maximumProfileSymptoms =
          (body['maximumProfileSymptoms'] as num?)?.toInt() ?? 0;
      final preferredPayloadSchemaVersion =
          (body['preferredPayloadSchemaVersion'] as num?)?.toInt() ?? 0;
      final independentProfilesEnabled =
          body['independentProfilesEnabled'] == true;
      final maximumBackdateDays =
          (body['maximumBackdateDays'] as num?)?.toInt() ?? 0;
      if (minimumBuild < 1 ||
          latestBuild < minimumBuild ||
          body['clinicManagedProfiles'] != true ||
          body['canonicalDisorders'] != true ||
          body['independentProfileModel'] != true ||
          body['patientDiary'] != true ||
          maximumBackdateDays < 1 ||
          maximumBackdateDays > 30 ||
          maximumProfileSymptoms != 6 ||
          preferredPayloadSchemaVersion !=
              (independentProfilesEnabled ? 3 : 2)) {
        throw const ClinicProfileException(
          ClinicProfileFailure.invalidResponse,
          'The clinic returned an invalid app configuration.',
        );
      }
      return MobileConfiguration(
        minimumBuild: minimumBuild,
        latestBuild: latestBuild,
        googlePlayUrl: (body['googlePlayUrl'] as String?)?.trim() ?? '',
        appStoreUrl: (body['appStoreUrl'] as String?)?.trim() ?? '',
        canonicalDisorders: true,
        independentProfileModel: true,
        independentProfilesEnabled: independentProfilesEnabled,
        maximumProfileSymptoms: maximumProfileSymptoms,
        preferredPayloadSchemaVersion: preferredPayloadSchemaVersion,
        patientDiary: true,
        maximumBackdateDays: maximumBackdateDays,
      );
    } on ClinicProfileException {
      rethrow;
    } catch (_) {
      throw const ClinicProfileException(
        ClinicProfileFailure.networkUnavailable,
        'The clinic could not be reached to verify this app version.',
      );
    }
  }

  static Future<PatientProfile> fetchAssignedProfile(
    PatientProfile current,
  ) async {
    if (IdentityService.usesInMemoryStorage) {
      if (current.isClinicManaged) return current;
      throw const ClinicProfileException(
        ClinicProfileFailure.profileNotConfigured,
        'The clinic must finish assigning this profile before check-ins can continue.',
      );
    }
    final accessToken = await IdentityService.readAccessToken();
    if (accessToken == null) {
      throw const ClinicProfileException(
        ClinicProfileFailure.enrolmentRequired,
        'This phone must be enrolled with a clinic-issued code.',
      );
    }
    final base = ApiConfig.baseUrl.replaceAll(RegExp(r'/+$'), '');
    try {
      final response = await http
          .get(
            Uri.parse('$base/api/profile'),
            headers: IdentityService.mobileHeaders(accessToken: accessToken),
          )
          .timeout(const Duration(seconds: 10));
      final body = _jsonBody(response);
      if (response.statusCode == 426 || body['code'] == 'app_update_required') {
        throw _updateException(body);
      }
      if (response.statusCode == 401 || response.statusCode == 403) {
        throw const ClinicProfileException(
          ClinicProfileFailure.enrolmentRequired,
          'This phone is no longer enrolled. Ask the clinic for a new-device code.',
        );
      }
      if (response.statusCode == 409 &&
          body['code'] == 'profile_not_configured') {
        throw const ClinicProfileException(
          ClinicProfileFailure.profileNotConfigured,
          'The clinic must finish assigning this profile before check-ins can continue.',
        );
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw const ClinicProfileException(
          ClinicProfileFailure.invalidResponse,
          'The clinic could not provide the assigned profile.',
        );
      }
      try {
        final profile = PatientProfile.fromClinicResponse(
          body,
          reminderTime: current.reminderTime,
        );
        if (current.patientId.trim().isNotEmpty &&
            profile.patientId != current.patientId) {
          throw const FormatException('Patient identity changed.');
        }
        return profile;
      } catch (_) {
        throw const ClinicProfileException(
          ClinicProfileFailure.invalidResponse,
          'The clinic returned an incomplete assigned profile.',
        );
      }
    } on ClinicProfileException {
      rethrow;
    } catch (_) {
      throw const ClinicProfileException(
        ClinicProfileFailure.networkUnavailable,
        'The clinic could not be reached. Check your connection and try again.',
      );
    }
  }
}
