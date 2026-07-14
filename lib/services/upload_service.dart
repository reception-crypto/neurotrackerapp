import 'dart:convert';

import 'package:http/http.dart' as http;

import '../models/daily_entry.dart';
import 'api_config.dart';

class UploadService {
  static Future<bool> uploadDailyEntry(DailyEntry entry) async {
    final uri = Uri.parse('${ApiConfig.baseUrl}/api/symptom-entry');

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
          .timeout(const Duration(seconds: 8));

      return response.statusCode >= 200 && response.statusCode < 300;
    } catch (_) {
      return false;
    }
  }
}
