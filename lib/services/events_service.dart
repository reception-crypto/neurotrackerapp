import 'dart:convert';

import 'package:http/http.dart' as http;

import 'api_config.dart';
import 'identity_service.dart';

class ClinicEvent {
  final String id;
  final String label;
  final String question;
  final String type;
  final bool recordedToday;
  final bool available;
  final DateTime? nextAvailableAt;
  const ClinicEvent(
    this.id,
    this.label,
    this.question,
    this.type, {
    this.recordedToday = false,
    this.available = true,
    this.nextAvailableAt,
  });
  factory ClinicEvent.fromJson(
    Map<String, dynamic> value, {
    bool recordedToday = false,
  }) => ClinicEvent(
    value['id'] as String,
    value['label'] as String,
    value['question'] as String,
    value['type'] as String,
    recordedToday: recordedToday,
    available: value['available'] != false,
    nextAvailableAt: DateTime.tryParse(
      value['nextAvailableAt'] as String? ?? '',
    )?.toLocal(),
  );
}

class EventsService {
  static String get _base => ApiConfig.baseUrl.replaceAll(RegExp(r'/+$'), '');

  static Future<List<ClinicEvent>> assigned() async {
    final token = await IdentityService.readAccessToken();
    if (token == null) {
      throw Exception('This phone needs to be enrolled.');
    }
    final response = await http
        .get(
          Uri.parse('$_base/api/events'),
          headers: IdentityService.mobileHeaders(accessToken: token),
        )
        .timeout(const Duration(seconds: 10));
    if (response.statusCode != 200) {
      throw Exception('Events could not be loaded.');
    }
    final body = jsonDecode(response.body) as Map<String, dynamic>;
    final now = DateTime.now();
    final today =
        '${now.year.toString().padLeft(4, '0')}-'
        '${now.month.toString().padLeft(2, '0')}-'
        '${now.day.toString().padLeft(2, '0')}';
    final recordedIds = (body['entries'] as List<dynamic>)
        .where((entry) => entry['localDate'] == today)
        .map((entry) => entry['eventId'])
        .toSet();
    return (body['events'] as List<dynamic>)
        .map(
          (item) => ClinicEvent.fromJson(
            item as Map<String, dynamic>,
            recordedToday: recordedIds.contains(item['id']),
          ),
        )
        .toList();
  }

  static Future<void> record(ClinicEvent event, DateTime occurrence) async {
    final token = await IdentityService.readAccessToken();
    if (token == null) {
      throw Exception('This phone needs to be enrolled.');
    }
    final date =
        '${occurrence.year.toString().padLeft(4, '0')}-'
        '${occurrence.month.toString().padLeft(2, '0')}-'
        '${occurrence.day.toString().padLeft(2, '0')}';
    final response = await http
        .post(
          Uri.parse('$_base/api/events'),
          headers: IdentityService.mobileHeaders(
            json: true,
            accessToken: token,
          ),
          body: jsonEncode({
            'eventId': event.id,
            'occurredAt': occurrence.toUtc().toIso8601String(),
            'localDate': date,
          }),
        )
        .timeout(const Duration(seconds: 10));
    if (response.statusCode != 201) {
      final body = jsonDecode(response.body) as Map<String, dynamic>;
      throw Exception(body['error'] ?? 'The Event could not be recorded.');
    }
  }
}
