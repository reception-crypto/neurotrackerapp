import 'dart:convert';

import 'package:http/http.dart' as http;

import '../models/daily_entry.dart';
import 'api_config.dart';
import 'identity_service.dart';
import 'storage_service.dart';

enum UploadResult {
  success,
  notConfigured,
  enrolmentRequired,
  networkUnavailable,
  unauthorized,
  dailyAlreadyRecorded,
  rejected,
  serverUnavailable,
}

extension UploadResultMessage on UploadResult {
  bool get succeeded => this == UploadResult.success;
  bool get terminal =>
      this == UploadResult.success ||
      this == UploadResult.dailyAlreadyRecorded;

  String get patientMessage => switch (this) {
    UploadResult.success => 'Synced with the clinic.',
    UploadResult.notConfigured =>
      'The clinic connection has not been configured on this build.',
    UploadResult.enrolmentRequired =>
      'This phone is not enrolled. Open Settings and enter a clinic-issued enrolment code.',
    UploadResult.networkUnavailable =>
      'No connection is currently available. The check-in will retry automatically.',
    UploadResult.unauthorized =>
      'This phone is no longer authorised. Contact the clinic for a new enrolment code.',
    UploadResult.dailyAlreadyRecorded =>
      'The clinic already has a check-in for this patient today. Contact the clinic if it needs to be corrected.',
    UploadResult.rejected =>
      'The clinic server rejected this check-in. Please contact the clinic.',
    UploadResult.serverUnavailable =>
      'The clinic server is temporarily unavailable. The check-in will retry automatically.',
  };
}

class RetrySummary {
  final int uploaded;
  final int alreadyRecorded;
  final int remaining;
  final UploadResult? lastFailure;

  const RetrySummary({
    required this.uploaded,
    this.alreadyRecorded = 0,
    required this.remaining,
    this.lastFailure,
  });
}

class UploadService {
  static Future<UploadResult> uploadDailyEntry(DailyEntry entry) async {
    if (ApiConfig.baseUrl.trim().isEmpty) {
      return UploadResult.notConfigured;
    }
    final accessToken = await IdentityService.readAccessToken();
    if (accessToken == null) return UploadResult.enrolmentRequired;

    final base = ApiConfig.baseUrl.replaceAll(RegExp(r'/+$'), '');
    final uri = Uri.parse('$base/api/symptom-entry');

    try {
      final response = await http
          .post(
            uri,
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer $accessToken',
            },
            body: jsonEncode(entry.toApiJson()),
          )
          .timeout(const Duration(seconds: 10));

      if (response.statusCode >= 200 && response.statusCode < 300) {
        await StorageService.recordSuccessfulSync();
        return UploadResult.success;
      }
      if (response.statusCode == 401 || response.statusCode == 403) {
        return UploadResult.unauthorized;
      }
      if (response.statusCode == 409) {
        try {
          final body = Map<String, dynamic>.from(
            jsonDecode(response.body) as Map,
          );
          if (body['code'] == 'daily_submission_exists') {
            return UploadResult.dailyAlreadyRecorded;
          }
        } catch (_) {
          // Treat an unrecognised conflict as a general rejected submission.
        }
      }
      if (response.statusCode >= 400 && response.statusCode < 500) {
        return UploadResult.rejected;
      }
      return UploadResult.serverUnavailable;
    } catch (_) {
      return UploadResult.networkUnavailable;
    }
  }

  static Future<RetrySummary> retryPendingUploads() async {
    final pending = await StorageService.loadPendingEntries();
    var uploaded = 0;
    var alreadyRecorded = 0;
    UploadResult? lastFailure;
    for (final entry in pending) {
      final result = await uploadDailyEntry(entry);
      if (result.terminal) {
        await StorageService.removePendingEntry(entry.submissionId);
        if (result.succeeded) {
          uploaded++;
        } else {
          alreadyRecorded++;
          lastFailure = result;
        }
      } else {
        lastFailure = result;
      }
    }
    return RetrySummary(
      uploaded: uploaded,
      alreadyRecorded: alreadyRecorded,
      remaining: await StorageService.pendingCount(),
      lastFailure: lastFailure,
    );
  }
}
