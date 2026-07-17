import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import '../models/daily_entry.dart';
import '../models/patient_profile.dart';

class StorageService {
  static const String _profileKey = 'patient_profile';
  static const String _entriesKey = 'daily_entries';
  static const String _pendingKey = 'pending_uploads';
  static const String _lastSyncKey = 'last_successful_sync';
  static const String _lastSubmissionDateKey = 'last_submission_date';
  static const String _consentKey = 'consent_acceptance';
  static const String _entryHistoryKey = 'daily_entry_history';

  static Future<void> saveProfile(PatientProfile profile) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_profileKey, jsonEncode(profile.toJson()));
  }

  static Future<PatientProfile?> loadProfile() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_profileKey);
    if (raw == null) return null;
    final json = jsonDecode(raw) as Map<String, dynamic>;
    final profile = PatientProfile.fromJson(json);
    if ((json['patientId'] as String?)?.trim().isNotEmpty != true) {
      await prefs.setString(_profileKey, jsonEncode(profile.toJson()));
    }
    return profile;
  }

  static Future<void> saveEntryRows(List<String> csvRows) async {
    final prefs = await SharedPreferences.getInstance();
    final rows = prefs.getStringList(_entriesKey) ?? <String>[];
    rows.addAll(csvRows);
    await prefs.setStringList(_entriesKey, rows);
  }

  static Future<List<String>> loadEntries() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getStringList(_entriesKey) ?? <String>[];
  }

  static Future<void> addPendingEntry(DailyEntry entry) async {
    final prefs = await SharedPreferences.getInstance();
    final pending = prefs.getStringList(_pendingKey) ?? <String>[];
    if (!pending.any((raw) {
      try {
        return (jsonDecode(raw) as Map<String, dynamic>)['submissionId'] ==
            entry.submissionId;
      } catch (_) {
        return false;
      }
    })) {
      pending.add(jsonEncode(entry.toJson()));
      await prefs.setStringList(_pendingKey, pending);
    }
  }

  static Future<void> saveEntryToHistory(DailyEntry entry) async {
    final prefs = await SharedPreferences.getInstance();
    final history = prefs.getStringList(_entryHistoryKey) ?? <String>[];
    if (!history.any((raw) {
      try {
        return (jsonDecode(raw) as Map<String, dynamic>)['submissionId'] ==
            entry.submissionId;
      } catch (_) {
        return false;
      }
    })) {
      history.add(jsonEncode(entry.toJson()));
      await prefs.setStringList(_entryHistoryKey, history);
    }
  }

  static Future<List<DailyEntry>> loadEntryHistory() async {
    final prefs = await SharedPreferences.getInstance();
    final history = prefs.getStringList(_entryHistoryKey) ?? <String>[];
    final entries = <DailyEntry>[];
    for (final raw in history) {
      try {
        entries.add(DailyEntry.fromJson(
          Map<String, dynamic>.from(jsonDecode(raw) as Map),
        ));
      } catch (_) {
        // Ignore malformed legacy history entries.
      }
    }
    entries.sort((a, b) => '${b.date} ${b.time}'.compareTo('${a.date} ${a.time}'));
    return entries;
  }

  static Future<List<DailyEntry>> loadPendingEntries() async {
    final prefs = await SharedPreferences.getInstance();
    final pending = prefs.getStringList(_pendingKey) ?? <String>[];
    final entries = <DailyEntry>[];
    for (final raw in pending) {
      try {
        entries.add(DailyEntry.fromJson(
          Map<String, dynamic>.from(jsonDecode(raw) as Map),
        ));
      } catch (_) {
        // Ignore malformed legacy queue entries.
      }
    }
    return entries;
  }

  static Future<void> removePendingEntry(String submissionId) async {
    final prefs = await SharedPreferences.getInstance();
    final pending = prefs.getStringList(_pendingKey) ?? <String>[];
    pending.removeWhere((raw) {
      try {
        return (jsonDecode(raw) as Map<String, dynamic>)['submissionId'] ==
            submissionId;
      } catch (_) {
        return true;
      }
    });
    await prefs.setStringList(_pendingKey, pending);
  }

  static Future<int> pendingCount() async => (await loadPendingEntries()).length;

  static Future<void> recordSuccessfulSync() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_lastSyncKey, DateTime.now().toIso8601String());
  }

  static Future<void> recordSubmissionDate(String date) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_lastSubmissionDateKey, date);
  }

  static Future<bool> hasSubmittedOn(String date) async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_lastSubmissionDateKey) == date;
  }

  static Future<void> recordConsent({required String policyVersion}) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(
      _consentKey,
      jsonEncode({
        'policyVersion': policyVersion,
        'acceptedAt': DateTime.now().toUtc().toIso8601String(),
      }),
    );
  }

  static Future<DateTime?> lastSuccessfulSync() async {
    final prefs = await SharedPreferences.getInstance();
    final value = prefs.getString(_lastSyncKey);
    return value == null ? null : DateTime.tryParse(value);
  }

  static Future<void> resetAll() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_profileKey);
    await prefs.remove(_entriesKey);
    await prefs.remove(_pendingKey);
    await prefs.remove(_lastSyncKey);
    await prefs.remove(_lastSubmissionDateKey);
    await prefs.remove(_consentKey);
    await prefs.remove(_entryHistoryKey);
  }
}
