import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import '../models/patient_profile.dart';

class StorageService {
  static const String _profileKey = 'patient_profile';
  static const String _entriesKey = 'daily_entries';

  static Future<void> saveProfile(PatientProfile profile) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_profileKey, jsonEncode(profile.toJson()));
  }

  static Future<PatientProfile?> loadProfile() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_profileKey);
    if (raw == null) return null;
    return PatientProfile.fromJson(jsonDecode(raw) as Map<String, dynamic>);
  }

  static Future<void> saveEntry(String csvRow) async {
    final prefs = await SharedPreferences.getInstance();
    final rows = prefs.getStringList(_entriesKey) ?? [];
    rows.add(csvRow);
    await prefs.setStringList(_entriesKey, rows);
  }

  static Future<List<String>> loadEntries() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getStringList(_entriesKey) ?? [];
  }

  static Future<void> resetAll() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_profileKey);
    await prefs.remove(_entriesKey);
  }
}
