import 'dart:convert';

import 'package:http/http.dart' as http;

import '../models/daily_entry.dart';
import 'api_config.dart';
import 'storage_service.dart';

class UploadService {
  static Future<bool> uploadDailyEntry(DailyEntry entry) async {
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

      final succeeded = response.statusCode >= 200 && response.statusCode < 300;
      if (succeeded) await StorageService.recordSuccessfulSync();
      return succeeded;
    } catch (_) {
      return false;
    }
  }

  static Future<int> retryPendingUploads() async {
    final pending = await StorageService.loadPendingEntries();
    var uploaded = 0;
    for (final entry in pending) {
      if (await uploadDailyEntry(entry)) {
        await StorageService.removePendingEntry(entry.submissionId);
        uploaded++;
      }
    }
    return uploaded;
  }
}
