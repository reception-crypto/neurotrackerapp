import 'dart:convert';

import 'package:http/http.dart' as http;

import '../models/daily_entry.dart';
import 'api_config.dart';
import 'identity_service.dart';
import 'storage_service.dart';

class DiaryHistoryResult {
  final List<DailyEntry> entries;
  final bool clinicSynced;
  final String statusMessage;

  const DiaryHistoryResult({
    required this.entries,
    required this.clinicSynced,
    required this.statusMessage,
  });
}

class DiaryService {
  DiaryService._();

  static Future<DiaryHistoryResult> loadHistory({int days = 90}) async {
    final profile = await StorageService.loadProfile();
    final expectedPatientId = profile?.patientId.trim() ?? '';
    final localEntries = (await StorageService.loadEntryHistory())
        .where(
          (entry) =>
              expectedPatientId.isNotEmpty &&
              entry.patientId.trim() == expectedPatientId,
        )
        .toList(growable: false);
    if (IdentityService.usesInMemoryStorage) {
      return DiaryHistoryResult(
        entries: localEntries,
        clinicSynced: true,
        statusMessage: 'Showing check-ins saved on this device.',
      );
    }
    final accessToken = await IdentityService.readAccessToken();
    if (accessToken == null || ApiConfig.baseUrl.trim().isEmpty) {
      return DiaryHistoryResult(
        entries: localEntries,
        clinicSynced: false,
        statusMessage: 'Showing check-ins saved on this device.',
      );
    }

    try {
      final range = [30, 60, 90].contains(days) ? days : 90;
      final base = ApiConfig.baseUrl.replaceAll(RegExp(r'/+$'), '');
      final response = await http
          .get(
            Uri.parse('$base/api/diary?days=$range'),
            headers: IdentityService.mobileHeaders(accessToken: accessToken),
          )
          .timeout(const Duration(seconds: 10));
      if (response.statusCode == 426) {
        return DiaryHistoryResult(
          entries: localEntries,
          clinicSynced: false,
          statusMessage:
              'Update the app to synchronise the clinic diary history.',
        );
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw const FormatException('Diary request was rejected.');
      }
      final body = Map<String, dynamic>.from(jsonDecode(response.body) as Map);
      final rawEntries = body['entries'];
      if (rawEntries is! List) {
        throw const FormatException('Diary entries are missing.');
      }
      final remoteEntries = rawEntries
          .map((raw) {
            final entry = DailyEntry.fromJson(
              Map<String, dynamic>.from(raw as Map),
            );
            if (expectedPatientId.isEmpty ||
                entry.patientId != expectedPatientId ||
                entry.submissionId.trim().isEmpty ||
                entry.records.isEmpty) {
              throw const FormatException('Diary identity is invalid.');
            }
            return entry;
          })
          .toList(growable: false);
      // SharedPreferences history writes are read-modify-write operations, so
      // keep them sequential to avoid concurrent saves dropping an entry.
      for (final entry in remoteEntries) {
        await StorageService.saveEntryToHistory(entry);
      }
      final merged = <String, DailyEntry>{};
      for (final entry in [...localEntries, ...remoteEntries]) {
        final key = entry.submissionId.trim().isNotEmpty
            ? entry.submissionId
            : '${entry.date}|${entry.time}';
        merged[key] = entry;
      }
      final entries = merged.values.toList()
        ..sort(
          (left, right) => '${right.date} ${right.time}'.compareTo(
            '${left.date} ${left.time}',
          ),
        );
      return DiaryHistoryResult(
        entries: entries,
        clinicSynced: true,
        statusMessage: 'Clinic diary is up to date.',
      );
    } catch (_) {
      return DiaryHistoryResult(
        entries: localEntries,
        clinicSynced: false,
        statusMessage:
            'Clinic history is temporarily unavailable. Showing entries saved on this device.',
      );
    }
  }
}
