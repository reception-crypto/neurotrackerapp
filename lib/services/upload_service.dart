import 'dart:convert';

import 'package:http/http.dart' as http;

import '../models/daily_entry.dart';
import 'api_config.dart';
import 'storage_service.dart';

enum UploadResult {
  success,
  notConfigured,
  networkUnavailable,
  unauthorized,
  rejected,
  serverUnavailable,
}

extension UploadResultMessage on UploadResult {
  bool get succeeded => this == UploadResult.success;

  String get patientMessage => switch (this) {
        UploadResult.success => 'Synced with the clinic.',
        UploadResult.notConfigured =>
          'The clinic connection has not been configured on this build.',
        UploadResult.networkUnavailable =>
          'No connection is currently available. The check-in will retry automatically.',
        UploadResult.unauthorized =>
          'The clinic connection could not be authorised. Please contact the clinic.',
        UploadResult.rejected =>
          'The clinic server rejected this check-in. Please contact the clinic.',
        UploadResult.serverUnavailable =>
          'The clinic server is temporarily unavailable. The check-in will retry automatically.',
      };
}

class RetrySummary {
  final int uploaded;
  final int remaining;
  final UploadResult? lastFailure;

  const RetrySummary({
    required this.uploaded,
    required this.remaining,
    this.lastFailure,
  });
}

class UploadService {
  static Future<UploadResult> uploadDailyEntry(DailyEntry entry) async {
    if (ApiConfig.baseUrl.trim().isEmpty ||
        ApiConfig.apiKey.trim().isEmpty ||
        ApiConfig.apiKey.startsWith('change-this')) {
      return UploadResult.notConfigured;
    }
    final base = ApiConfig.baseUrl.replaceAll(RegExp(r'/+$'), '');
    final uri = Uri.parse('$base/api/symptom-entry');

    try {
      final response = await http
          .post(
            uri,
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': ApiConfig.apiKey,
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
    UploadResult? lastFailure;
    for (final entry in pending) {
      final result = await uploadDailyEntry(entry);
      if (result.succeeded) {
        await StorageService.removePendingEntry(entry.submissionId);
        uploaded++;
      } else {
        lastFailure = result;
      }
    }
    return RetrySummary(
      uploaded: uploaded,
      remaining: await StorageService.pendingCount(),
      lastFailure: lastFailure,
    );
  }
}
