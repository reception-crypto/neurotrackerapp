import 'dart:math';

import 'package:flutter/material.dart';

class PatientProfile {
  final String patientId;
  final String fullName;
  final String primaryDisorder;
  final List<String> primarySymptoms;
  final String? secondaryDisorder;
  final List<String> secondarySymptoms;
  final TimeOfDay reminderTime;
  final int profileRevision;

  const PatientProfile({
    required this.patientId,
    required this.fullName,
    required this.primaryDisorder,
    required this.primarySymptoms,
    this.secondaryDisorder,
    this.secondarySymptoms = const [],
    required this.reminderTime,
    this.profileRevision = 0,
  });

  bool get hasSecondaryDisorder =>
      secondaryDisorder != null &&
      secondaryDisorder!.isNotEmpty &&
      secondarySymptoms.isNotEmpty;

  bool get isClinicManaged => profileRevision > 0;

  String get supportId {
    final compact = patientId.toUpperCase().replaceAll(
      RegExp(r'[^A-Z0-9]'),
      '',
    );
    if (compact.isEmpty) return 'NS-UNAVAILABLE';
    final suffix = compact.length <= 12
        ? compact
        : compact.substring(compact.length - 12);
    final groups = <String>[];
    for (var index = 0; index < suffix.length; index += 4) {
      groups.add(suffix.substring(index, min(index + 4, suffix.length)));
    }
    return 'NS-${groups.join('-')}';
  }

  PatientProfile copyWith({
    String? patientId,
    String? fullName,
    String? primaryDisorder,
    List<String>? primarySymptoms,
    String? secondaryDisorder,
    bool clearSecondaryDisorder = false,
    List<String>? secondarySymptoms,
    TimeOfDay? reminderTime,
    int? profileRevision,
  }) {
    return PatientProfile(
      patientId: patientId ?? this.patientId,
      fullName: fullName ?? this.fullName,
      primaryDisorder: primaryDisorder ?? this.primaryDisorder,
      primarySymptoms: primarySymptoms ?? this.primarySymptoms,
      secondaryDisorder: clearSecondaryDisorder
          ? null
          : secondaryDisorder ?? this.secondaryDisorder,
      secondarySymptoms: secondarySymptoms ?? this.secondarySymptoms,
      reminderTime: reminderTime ?? this.reminderTime,
      profileRevision: profileRevision ?? this.profileRevision,
    );
  }

  Map<String, dynamic> toJson() => {
    'patientId': patientId,
    'fullName': fullName,
    'primaryDisorder': primaryDisorder,
    'primarySymptoms': primarySymptoms,
    'secondaryDisorder': secondaryDisorder,
    'secondarySymptoms': secondarySymptoms,
    'reminderHour': reminderTime.hour,
    'reminderMinute': reminderTime.minute,
    'profileRevision': profileRevision,
  };

  factory PatientProfile.fromJson(Map<String, dynamic> json) {
    final oldDisorder = json['disorder'] as String?;
    final oldSymptoms = json['symptoms'];

    return PatientProfile(
      patientId: (json['patientId'] as String?)?.trim().isNotEmpty == true
          ? json['patientId'] as String
          : '',
      fullName: json['fullName'] as String? ?? '',
      primaryDisorder:
          (json['primaryDisorder'] as String?) ?? oldDisorder ?? 'Migraine',
      primarySymptoms: List<String>.from(
        (json['primarySymptoms'] as List?) ?? oldSymptoms as List? ?? const [],
      ),
      secondaryDisorder: json['secondaryDisorder'] as String?,
      secondarySymptoms: List<String>.from(
        (json['secondarySymptoms'] as List?) ?? const [],
      ),
      reminderTime: TimeOfDay(
        hour: (json['reminderHour'] as num?)?.toInt() ?? 19,
        minute: (json['reminderMinute'] as num?)?.toInt() ?? 0,
      ),
      profileRevision: (json['profileRevision'] as num?)?.toInt() ?? 0,
    );
  }

  factory PatientProfile.fromClinicResponse(
    Map<String, dynamic> json, {
    required TimeOfDay reminderTime,
  }) {
    final patientId = (json['patientId'] as String?)?.trim() ?? '';
    final displayName = (json['displayName'] as String?)?.trim() ?? '';
    final rawProfile = json['clinicalProfile'];
    if (rawProfile is! Map) {
      throw const FormatException('Clinical profile is missing.');
    }
    final clinicalProfile = Map<String, dynamic>.from(rawProfile);
    final primaryDisorder =
        (clinicalProfile['primaryDisorder'] as String?)?.trim() ?? '';
    final primarySymptoms = List<String>.from(
      (clinicalProfile['primarySymptoms'] as List?) ?? const [],
    ).map((value) => value.trim()).where((value) => value.isNotEmpty).toList();
    final secondaryDisorderText =
        (clinicalProfile['secondaryDisorder'] as String?)?.trim() ?? '';
    final secondarySymptoms = List<String>.from(
      (clinicalProfile['secondarySymptoms'] as List?) ?? const [],
    ).map((value) => value.trim()).where((value) => value.isNotEmpty).toList();
    final revision = (clinicalProfile['revision'] as num?)?.toInt() ?? 0;

    final hasSecond = secondaryDisorderText.isNotEmpty;
    if (patientId.isEmpty ||
        displayName.isEmpty ||
        primaryDisorder.isEmpty ||
        primarySymptoms.length != 3 ||
        primarySymptoms.toSet().length != 3 ||
        revision < 1 ||
        (hasSecond &&
            (secondarySymptoms.length != 3 ||
                secondarySymptoms.toSet().length != 3)) ||
        (!hasSecond && secondarySymptoms.isNotEmpty)) {
      throw const FormatException('Clinical profile is incomplete.');
    }

    return PatientProfile(
      patientId: patientId,
      fullName: displayName,
      primaryDisorder: primaryDisorder,
      primarySymptoms: primarySymptoms,
      secondaryDisorder: hasSecond ? secondaryDisorderText : null,
      secondarySymptoms: hasSecond ? secondarySymptoms : const [],
      reminderTime: reminderTime,
      profileRevision: revision,
    );
  }
}
