import 'dart:math';

import 'package:flutter/material.dart';

const int independentProfileSchemaVersion = 3;
const int maximumIndependentProfileSymptoms = 6;

class AssignedSymptom {
  final String track;
  final String disorderId;
  final String disorder;
  final String symptomId;
  final String symptom;

  const AssignedSymptom({
    required this.track,
    required this.disorderId,
    required this.disorder,
    required this.symptomId,
    required this.symptom,
  });

  String get scoreKey {
    if (track == 'Independent') {
      return 'Independent||${symptomId.isNotEmpty ? symptomId : symptom}';
    }
    // Retain the Build 7 score key for nested profiles so an app update does
    // not change locally queued or in-progress data semantics.
    return '$track|$disorder|$symptom';
  }
}

class PatientProfile {
  final String patientId;
  final String fullName;
  final int schemaVersion;

  // Build 7/schema 1 and canonical nested/schema 2 fields.
  final String primaryDisorderId;
  final String primaryDisorder;
  final List<String> primarySymptomIds;
  final List<String> primarySymptoms;
  final String? secondaryDisorderId;
  final String? secondaryDisorder;
  final List<String> secondarySymptomIds;
  final List<String> secondarySymptoms;

  // Build 8/schema 3 fields. Disorders classify the patient but do not own
  // symptoms; every independently assigned symptom is rated exactly once.
  final List<String> disorderIds;
  final List<String> disorders;
  final List<String> symptomIds;
  final List<String> symptoms;

  final TimeOfDay reminderTime;
  final int profileRevision;

  const PatientProfile({
    required this.patientId,
    required this.fullName,
    this.schemaVersion = 1,
    this.primaryDisorderId = '',
    this.primaryDisorder = '',
    this.primarySymptomIds = const [],
    this.primarySymptoms = const [],
    this.secondaryDisorderId,
    this.secondaryDisorder,
    this.secondarySymptomIds = const [],
    this.secondarySymptoms = const [],
    this.disorderIds = const [],
    this.disorders = const [],
    this.symptomIds = const [],
    this.symptoms = const [],
    required this.reminderTime,
    this.profileRevision = 0,
  });

  bool get isIndependent => schemaVersion == independentProfileSchemaVersion;

  bool get hasSecondaryDisorder =>
      !isIndependent &&
      secondaryDisorder != null &&
      secondaryDisorder!.isNotEmpty &&
      secondarySymptoms.isNotEmpty;

  bool get isClinicManaged => profileRevision > 0;

  List<String> get assignedDisorders => isIndependent
      ? disorders
      : [
          if (primaryDisorder.isNotEmpty) primaryDisorder,
          if (hasSecondaryDisorder) secondaryDisorder!,
        ];

  List<String> get assignedDisorderIds => isIndependent
      ? disorderIds
      : [
          if (primaryDisorderId.isNotEmpty) primaryDisorderId,
          if (hasSecondaryDisorder &&
              secondaryDisorderId?.isNotEmpty == true)
            secondaryDisorderId!,
        ];

  List<AssignedSymptom> get symptomAssignments {
    if (isIndependent) {
      return List<AssignedSymptom>.generate(
        symptoms.length,
        (index) => AssignedSymptom(
          track: 'Independent',
          disorderId: '',
          disorder: '',
          symptomId: symptomIds[index],
          symptom: symptoms[index],
        ),
        growable: false,
      );
    }

    final assignments = <AssignedSymptom>[];
    for (var index = 0; index < primarySymptoms.length; index++) {
      assignments.add(
        AssignedSymptom(
          track: 'Primary',
          disorderId: primaryDisorderId,
          disorder: primaryDisorder,
          symptomId: index < primarySymptomIds.length
              ? primarySymptomIds[index]
              : '',
          symptom: primarySymptoms[index],
        ),
      );
    }
    if (hasSecondaryDisorder) {
      for (var index = 0; index < secondarySymptoms.length; index++) {
        assignments.add(
          AssignedSymptom(
            track: 'Second',
            disorderId: secondaryDisorderId ?? '',
            disorder: secondaryDisorder!,
            symptomId: index < secondarySymptomIds.length
                ? secondarySymptomIds[index]
                : '',
            symptom: secondarySymptoms[index],
          ),
        );
      }
    }
    return assignments;
  }

  int get payloadSchemaVersion {
    if (isIndependent) return independentProfileSchemaVersion;
    final primaryCanonical =
        primaryDisorderId.isNotEmpty &&
        primarySymptomIds.length == primarySymptoms.length &&
        primarySymptomIds.every((value) => value.isNotEmpty);
    final secondaryCanonical =
        !hasSecondaryDisorder ||
        (secondaryDisorderId?.isNotEmpty == true &&
            secondarySymptomIds.length == secondarySymptoms.length &&
            secondarySymptomIds.every((value) => value.isNotEmpty));
    return schemaVersion >= 2 && primaryCanonical && secondaryCanonical ? 2 : 1;
  }

  String get settingsSummary {
    if (isIndependent) {
      return 'Disorders: ${disorders.join(', ')}\n'
          'Symptoms: ${symptoms.join(', ')}';
    }
    return '$primaryDisorder: ${primarySymptoms.join(', ')}'
        '${hasSecondaryDisorder ? '\n$secondaryDisorder: ${secondarySymptoms.join(', ')}' : ''}';
  }

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
    int? schemaVersion,
    String? primaryDisorderId,
    String? primaryDisorder,
    List<String>? primarySymptomIds,
    List<String>? primarySymptoms,
    String? secondaryDisorderId,
    String? secondaryDisorder,
    bool clearSecondaryDisorder = false,
    List<String>? secondarySymptomIds,
    List<String>? secondarySymptoms,
    List<String>? disorderIds,
    List<String>? disorders,
    List<String>? symptomIds,
    List<String>? symptoms,
    TimeOfDay? reminderTime,
    int? profileRevision,
  }) {
    return PatientProfile(
      patientId: patientId ?? this.patientId,
      fullName: fullName ?? this.fullName,
      schemaVersion: schemaVersion ?? this.schemaVersion,
      primaryDisorderId: primaryDisorderId ?? this.primaryDisorderId,
      primaryDisorder: primaryDisorder ?? this.primaryDisorder,
      primarySymptomIds: primarySymptomIds ?? this.primarySymptomIds,
      primarySymptoms: primarySymptoms ?? this.primarySymptoms,
      secondaryDisorderId: clearSecondaryDisorder
          ? null
          : secondaryDisorderId ?? this.secondaryDisorderId,
      secondaryDisorder: clearSecondaryDisorder
          ? null
          : secondaryDisorder ?? this.secondaryDisorder,
      secondarySymptomIds: clearSecondaryDisorder
          ? const []
          : secondarySymptomIds ?? this.secondarySymptomIds,
      secondarySymptoms: clearSecondaryDisorder
          ? const []
          : secondarySymptoms ?? this.secondarySymptoms,
      disorderIds: disorderIds ?? this.disorderIds,
      disorders: disorders ?? this.disorders,
      symptomIds: symptomIds ?? this.symptomIds,
      symptoms: symptoms ?? this.symptoms,
      reminderTime: reminderTime ?? this.reminderTime,
      profileRevision: profileRevision ?? this.profileRevision,
    );
  }

  Map<String, dynamic> toJson() => {
    'patientId': patientId,
    'fullName': fullName,
    'schemaVersion': schemaVersion,
    'primaryDisorderId': primaryDisorderId,
    'primaryDisorder': primaryDisorder,
    'primarySymptomIds': primarySymptomIds,
    'primarySymptoms': primarySymptoms,
    'secondaryDisorderId': secondaryDisorderId,
    'secondaryDisorder': secondaryDisorder,
    'secondarySymptomIds': secondarySymptomIds,
    'secondarySymptoms': secondarySymptoms,
    'disorderIds': disorderIds,
    'disorders': disorders,
    'symptomIds': symptomIds,
    'symptoms': symptoms,
    'reminderHour': reminderTime.hour,
    'reminderMinute': reminderTime.minute,
    'profileRevision': profileRevision,
  };

  factory PatientProfile.fromJson(Map<String, dynamic> json) {
    final oldDisorder = json['disorder'] as String?;
    final oldSymptoms = json['symptoms'];
    final schemaVersion = _schemaVersion(json['schemaVersion']);
    final primaryDisorder = _text(json['primaryDisorder']);

    return PatientProfile(
      patientId: _text(json['patientId']),
      fullName: _text(json['fullName']),
      schemaVersion: schemaVersion,
      primaryDisorderId: _text(json['primaryDisorderId']),
      primaryDisorder: primaryDisorder.isNotEmpty
          ? primaryDisorder
          : (oldDisorder ?? (schemaVersion == 3 ? '' : 'Migraine')),
      primarySymptomIds: _textList(json['primarySymptomIds']),
      primarySymptoms: _textList(
        json['primarySymptoms'] ?? (schemaVersion == 3 ? null : oldSymptoms),
      ),
      secondaryDisorderId: _nullableText(json['secondaryDisorderId']),
      secondaryDisorder: _nullableText(json['secondaryDisorder']),
      secondarySymptomIds: _textList(json['secondarySymptomIds']),
      secondarySymptoms: _textList(json['secondarySymptoms']),
      disorderIds: _textList(json['disorderIds']),
      disorders: _textList(json['disorders']),
      symptomIds: schemaVersion == 3 ? _textList(json['symptomIds']) : const [],
      symptoms: schemaVersion == 3 ? _textList(json['symptoms']) : const [],
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
    final patientId = _text(json['patientId']);
    final displayName = _text(json['displayName']);
    final rawProfile = json['clinicalProfile'];
    if (rawProfile is! Map) {
      throw const FormatException('Clinical profile is missing.');
    }
    final clinicalProfile = Map<String, dynamic>.from(rawProfile);
    final schemaVersion = _schemaVersion(clinicalProfile['schemaVersion']);
    final revision = (clinicalProfile['revision'] as num?)?.toInt() ?? 0;

    if (patientId.isEmpty || displayName.isEmpty || revision < 1) {
      throw const FormatException('Clinical profile is incomplete.');
    }

    if (schemaVersion == independentProfileSchemaVersion) {
      final disorderIds = _textList(clinicalProfile['disorderIds']);
      final disorders = _textList(clinicalProfile['disorders']);
      final symptomIds = _textList(clinicalProfile['symptomIds']);
      final symptoms = _textList(clinicalProfile['symptoms']);
      if (disorderIds.isEmpty ||
          disorderIds.length != disorders.length ||
          disorderIds.toSet().length != disorderIds.length ||
          disorders.toSet().length != disorders.length ||
          symptomIds.isEmpty ||
          symptomIds.length > maximumIndependentProfileSymptoms ||
          symptomIds.length != symptoms.length ||
          symptomIds.toSet().length != symptomIds.length ||
          symptoms.toSet().length != symptoms.length) {
        throw const FormatException(
          'Independent clinical profile is incomplete.',
        );
      }
      return PatientProfile(
        patientId: patientId,
        fullName: displayName,
        schemaVersion: schemaVersion,
        disorderIds: disorderIds,
        disorders: disorders,
        symptomIds: symptomIds,
        symptoms: symptoms,
        reminderTime: reminderTime,
        profileRevision: revision,
      );
    }

    if (schemaVersion != 1 && schemaVersion != 2) {
      throw const FormatException('Clinical profile schema is not supported.');
    }
    final primaryDisorderId = _text(clinicalProfile['primaryDisorderId']);
    final primaryDisorder = _text(clinicalProfile['primaryDisorder']);
    final primarySymptomIds = _textList(
      clinicalProfile['primarySymptomIds'],
    );
    final primarySymptoms = _textList(clinicalProfile['primarySymptoms']);
    final secondaryDisorderId = _nullableText(
      clinicalProfile['secondaryDisorderId'],
    );
    final secondaryDisorder = _nullableText(
      clinicalProfile['secondaryDisorder'],
    );
    final secondarySymptomIds = _textList(
      clinicalProfile['secondarySymptomIds'],
    );
    final secondarySymptoms = _textList(
      clinicalProfile['secondarySymptoms'],
    );
    final hasSecond = secondaryDisorder?.isNotEmpty == true;
    final canonicalPrimaryValid =
        schemaVersion == 1 ||
        (primaryDisorderId.isNotEmpty &&
            primarySymptomIds.length == 3 &&
            primarySymptomIds.toSet().length == 3);
    final canonicalSecondaryValid =
        schemaVersion == 1 ||
        !hasSecond ||
        (secondaryDisorderId?.isNotEmpty == true &&
            secondarySymptomIds.length == 3 &&
            secondarySymptomIds.toSet().length == 3);

    if (primaryDisorder.isEmpty ||
        primarySymptoms.length != 3 ||
        primarySymptoms.toSet().length != 3 ||
        !canonicalPrimaryValid ||
        !canonicalSecondaryValid ||
        (hasSecond &&
            (secondarySymptoms.length != 3 ||
                secondarySymptoms.toSet().length != 3)) ||
        (!hasSecond &&
            (secondarySymptoms.isNotEmpty ||
                secondarySymptomIds.isNotEmpty ||
                secondaryDisorderId?.isNotEmpty == true))) {
      throw const FormatException('Clinical profile is incomplete.');
    }

    return PatientProfile(
      patientId: patientId,
      fullName: displayName,
      schemaVersion: schemaVersion,
      primaryDisorderId: primaryDisorderId,
      primaryDisorder: primaryDisorder,
      primarySymptomIds: primarySymptomIds,
      primarySymptoms: primarySymptoms,
      secondaryDisorderId: hasSecond ? secondaryDisorderId : null,
      secondaryDisorder: hasSecond ? secondaryDisorder : null,
      secondarySymptomIds: hasSecond ? secondarySymptomIds : const [],
      secondarySymptoms: hasSecond ? secondarySymptoms : const [],
      reminderTime: reminderTime,
      profileRevision: revision,
    );
  }

  static int _schemaVersion(Object? value) {
    if (value == null || '$value'.trim().isEmpty) return 1;
    if (value is num) return value.toInt();
    return int.tryParse('$value') ?? -1;
  }

  static String _text(Object? value) => value is String ? value.trim() : '';

  static String? _nullableText(Object? value) {
    final text = _text(value);
    return text.isEmpty ? null : text;
  }

  static List<String> _textList(Object? value) {
    if (value is! List) return const [];
    return value
        .whereType<String>()
        .map((item) => item.trim())
        .where((item) => item.isNotEmpty)
        .toList(growable: false);
  }
}
