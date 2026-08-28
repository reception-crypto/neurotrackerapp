import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;

import '../app_identity.dart';
import '../models/patient_profile.dart';
import 'api_config.dart';

class EnrolmentResult {
  final PatientProfile profile;

  const EnrolmentResult({required this.profile});

  String get patientId => profile.patientId;
  String get displayName => profile.fullName;
}

class EnrolmentException implements Exception {
  final String patientMessage;

  const EnrolmentException(this.patientMessage);

  @override
  String toString() => patientMessage;
}

class IdentityService {
  static const _tokenKey = 'clinic_device_access_token';
  static final _storage = FlutterSecureStorage();

  @visibleForTesting
  static bool useInMemoryStorageForTesting = false;

  @visibleForTesting
  static String? accessTokenForTesting;

  static bool get usesInMemoryStorage => useInMemoryStorageForTesting;

  static Map<String, String> mobileHeaders({
    bool json = false,
    String? accessToken,
  }) => {
    if (json) 'Content-Type': 'application/json',
    'X-NeuroSol-Build': '$appBuildNumber',
    'X-NeuroSol-Profile': clinicProfileProtocol,
    'X-NeuroSol-Disorders': canonicalDisorderProtocol,
    'X-NeuroSol-Profile-Model': independentProfileProtocol,
    'X-NeuroSol-Diary': patientDiaryProtocol,
    'X-NeuroSol-UTC-Offset-Minutes':
        '${DateTime.now().timeZoneOffset.inMinutes}',
    if (accessToken?.trim().isNotEmpty == true)
      'Authorization': 'Bearer ${accessToken!.trim()}',
  };

  static Future<String?> readAccessToken() async {
    if (useInMemoryStorageForTesting) return accessTokenForTesting;
    try {
      final token = await _storage.read(key: _tokenKey);
      return token?.trim().isNotEmpty == true ? token : null;
    } catch (_) {
      return null;
    }
  }

  static Future<bool> hasAccessToken() async =>
      (await readAccessToken()) != null;

  static Future<void> saveAccessToken(String token) async {
    final value = token.trim();
    if (value.isEmpty) {
      throw const EnrolmentException(
        'The clinic returned an invalid device credential.',
      );
    }
    if (useInMemoryStorageForTesting) {
      accessTokenForTesting = value;
      return;
    }
    await _storage.write(key: _tokenKey, value: value);
  }

  static Future<void> clearAccessToken() async {
    if (useInMemoryStorageForTesting) {
      accessTokenForTesting = null;
      return;
    }
    try {
      await _storage.delete(key: _tokenKey);
    } catch (_) {
      // Local app data must still be reset if secure storage is unavailable.
    }
  }

  static Future<EnrolmentResult> enrol(
    String code, {
    String? expectedPatientId,
  }) async {
    final normalisedCode = code.toUpperCase().replaceAll(
      RegExp(r'[^A-Z0-9]'),
      '',
    );
    if (normalisedCode.length != 12) {
      throw const EnrolmentException(
        'Enter the 12-character enrolment code supplied by the clinic.',
      );
    }
    if (ApiConfig.baseUrl.trim().isEmpty) {
      throw const EnrolmentException(
        'The clinic connection is not configured in this app build.',
      );
    }

    final base = ApiConfig.baseUrl.replaceAll(RegExp(r'/+$'), '');
    final uri = Uri.parse('$base/api/enrol');

    late http.Response response;
    try {
      response = await http
          .post(
            uri,
            headers: mobileHeaders(json: true),
            body: jsonEncode({
              'code': normalisedCode,
              if (expectedPatientId?.trim().isNotEmpty == true)
                'expectedPatientId': expectedPatientId!.trim(),
            }),
          )
          .timeout(const Duration(seconds: 15));
    } catch (_) {
      throw const EnrolmentException(
        'The clinic could not be reached. Check your connection and try again.',
      );
    }

    Map<String, dynamic> body = const {};
    try {
      body = Map<String, dynamic>.from(jsonDecode(response.body) as Map);
    } catch (_) {
      // The status-specific message below remains safe for malformed responses.
    }

    if (response.statusCode >= 200 && response.statusCode < 300) {
      final patientId = (body['patientId'] as String?)?.trim() ?? '';
      final accessToken = (body['accessToken'] as String?)?.trim() ?? '';
      if (patientId.isEmpty || accessToken.isEmpty) {
        throw const EnrolmentException(
          'The clinic returned an incomplete enrolment response.',
        );
      }
      late PatientProfile profile;
      try {
        profile = PatientProfile.fromClinicResponse(
          body,
          reminderTime: const TimeOfDay(hour: 19, minute: 0),
        );
      } catch (_) {
        throw const EnrolmentException(
          'The clinic returned an incomplete clinical profile. Ask the clinic to review your enrolment.',
        );
      }
      try {
        await saveAccessToken(accessToken);
      } catch (_) {
        throw const EnrolmentException(
          'The code was accepted, but this phone could not protect its clinic credential. Contact the clinic for a replacement code.',
        );
      }
      return EnrolmentResult(profile: profile);
    }

    if (response.statusCode == 426 || body['code'] == 'app_update_required') {
      throw const EnrolmentException(
        'Update NeuroSol Symptom Diary to the newest version before enrolling this phone.',
      );
    }
    if (response.statusCode == 400 ||
        response.statusCode == 404 ||
        response.statusCode == 410) {
      throw const EnrolmentException(
        'That enrolment code is invalid, expired, or has already been used. Ask the clinic for a new code.',
      );
    }
    if (response.statusCode == 429) {
      throw const EnrolmentException(
        'Too many attempts were made. Wait a few minutes before trying again.',
      );
    }
    if (response.statusCode == 409 &&
        body['code'] == 'enrolment_patient_mismatch') {
      throw const EnrolmentException(
        'That code belongs to a different clinic record. Ask the clinic for a new-device code using the Support ID shown on this phone.',
      );
    }
    throw const EnrolmentException(
      'Enrolment is temporarily unavailable. Please try again later.',
    );
  }
}
