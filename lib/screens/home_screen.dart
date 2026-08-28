import 'package:flutter/material.dart';

import '../app_identity.dart';
import '../models/patient_profile.dart';
import '../services/clinic_profile_service.dart';
import '../services/diary_service.dart';
import '../services/identity_service.dart';
import '../services/storage_service.dart';
import '../services/upload_service.dart';
import '../theme/app_theme.dart';
import '../widgets/brand_identity.dart';
import 'daily_symptom_screen.dart';
import 'enrolment_screen.dart';
import 'history_screen.dart';
import 'settings_screen.dart';
import 'startup_blocked_screen.dart';
import 'startup_screen.dart';

class HomeScreen extends StatefulWidget {
  final PatientProfile profile;

  const HomeScreen({super.key, required this.profile});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> with WidgetsBindingObserver {
  late PatientProfile _profile;
  bool _loading = true;
  bool _checkingAccess = false;
  bool _completedToday = false;
  int _maximumBackdateDays = defaultMaximumBackdateDays;
  Set<String> _submittedDates = <String>{};
  int _pendingUploads = 0;
  DateTime? _lastSync;

  @override
  void initState() {
    super.initState();
    _profile = widget.profile;
    WidgetsBinding.instance.addObserver(this);
    _loadStatus();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _loadStatus();
    }
  }

  Future<void> _loadStatus({bool syncClinicProfile = true}) async {
    var profile = await StorageService.loadProfile();
    final storedProfile = profile;
    var maximumBackdateDays = _maximumBackdateDays;
    if (syncClinicProfile &&
        storedProfile != null &&
        await IdentityService.hasAccessToken()) {
      var activeProfile = storedProfile;
      try {
        final configuration =
            await ClinicProfileService.fetchMobileConfiguration();
        maximumBackdateDays = configuration.maximumBackdateDays;
        if (configuration.updateRequired) {
          if (!mounted) return;
          _replaceAll(
            RequiredUpdateScreen(
              googlePlayUrl: configuration.googlePlayUrl,
              appStoreUrl: configuration.appStoreUrl,
            ),
          );
          return;
        }
      } on ClinicProfileException catch (error) {
        if (error.failure == ClinicProfileFailure.updateRequired) {
          if (!mounted) return;
          _replaceAll(
            RequiredUpdateScreen(
              googlePlayUrl: error.googlePlayUrl,
              appStoreUrl: error.appStoreUrl,
            ),
          );
          return;
        }
        // Continue with the last valid clinic profile while offline.
      }
      try {
        activeProfile = await ClinicProfileService.fetchAssignedProfile(
          activeProfile,
        );
        await StorageService.saveProfile(activeProfile);
        profile = activeProfile;
      } on ClinicProfileException catch (error) {
        if (!mounted) return;
        switch (error.failure) {
          case ClinicProfileFailure.updateRequired:
            _replaceAll(
              RequiredUpdateScreen(
                googlePlayUrl: error.googlePlayUrl,
                appStoreUrl: error.appStoreUrl,
              ),
            );
            return;
          case ClinicProfileFailure.enrolmentRequired:
            _replaceAll(EnrolmentScreen(existingProfile: activeProfile));
            return;
          case ClinicProfileFailure.profileNotConfigured:
          case ClinicProfileFailure.invalidResponse:
            _replaceAll(
              ClinicSetupRequiredScreen(
                profile: activeProfile,
                message: error.patientMessage,
                onRetry: (blockedContext) => Navigator.pushAndRemoveUntil(
                  blockedContext,
                  MaterialPageRoute(builder: (_) => const StartupScreen()),
                  (_) => false,
                ),
              ),
            );
            return;
          case ClinicProfileFailure.networkUnavailable:
            if (!activeProfile.isClinicManaged) {
              _replaceAll(
                ClinicSetupRequiredScreen(
                  profile: activeProfile,
                  message:
                      'Connect to the internet so this phone can receive the clinic-assigned profile.',
                  onRetry: (blockedContext) => Navigator.pushAndRemoveUntil(
                    blockedContext,
                    MaterialPageRoute(builder: (_) => const StartupScreen()),
                    (_) => false,
                  ),
                ),
              );
              return;
            }
        }
      }
    }
    if (profile != null && await IdentityService.hasAccessToken()) {
      // Pull the clinic-held dates before offering backdating so a replacement
      // phone does not invite the patient to repeat an already recorded day.
      await DiaryService.loadHistory(days: 30);
    }
    final completedToday = await StorageService.hasSubmittedToday();
    final submittedDates = await StorageService.submittedDates();
    final pendingUploads = await StorageService.pendingCount();
    final lastSync = await StorageService.lastSuccessfulSync();

    if (!mounted) return;
    setState(() {
      _profile = profile ?? _profile;
      _completedToday = completedToday;
      _maximumBackdateDays = maximumBackdateDays;
      _submittedDates = submittedDates;
      _pendingUploads = pendingUploads;
      _lastSync = lastSync;
      _loading = false;
    });
  }

  Future<void> _refresh() async {
    await _loadStatus();
    await UploadService.retryPendingUploads();
    await _loadStatus(syncClinicProfile: false);
  }

  void _replaceAll(Widget screen) {
    Navigator.pushAndRemoveUntil(
      context,
      MaterialPageRoute(builder: (_) => screen),
      (_) => false,
    );
  }

  Future<void> _startCheckIn() async {
    if (_checkingAccess) return;
    setState(() => _checkingAccess = true);
    final submittedDates = await StorageService.submittedDates();
    if (!mounted) return;
    setState(() => _checkingAccess = false);
    final now = DateTime.now();
    final candidateDates = List.generate(
      _maximumBackdateDays + 1,
      (index) => DateTime(now.year, now.month, now.day - index),
    );
    final selectedDate = await showDialog<DateTime>(
      context: context,
      builder: (dialogContext) => SimpleDialog(
        title: const Text('Choose check-in date'),
        children: candidateDates.map((date) {
          final dateKey = StorageService.localDateKey(date);
          final submitted = submittedDates.contains(dateKey);
          final dayLabel = _checkInDateLabel(date, now);
          return SimpleDialogOption(
            key: Key('check-in-date-$dateKey'),
            onPressed: submitted
                ? null
                : () => Navigator.pop(dialogContext, date),
            child: Row(
              children: [
                Icon(
                  submitted ? Icons.check_circle : Icons.calendar_today,
                  color: submitted
                      ? AppTheme.successGreen
                      : AppTheme.primaryBlue,
                ),
                const SizedBox(width: 12),
                Expanded(child: Text(dayLabel)),
                if (submitted)
                  const Text('Recorded', style: TextStyle(fontSize: 12)),
              ],
            ),
          );
        }).toList(),
      ),
    );
    if (!mounted) return;
    if (selectedDate == null) return;
    setState(() => _checkingAccess = true);
    final selectedDateKey = StorageService.localDateKey(selectedDate);
    final alreadyCompleted = await StorageService.hasSubmittedOn(
      selectedDateKey,
    );
    if (!mounted) return;
    if (alreadyCompleted) {
      setState(() => _checkingAccess = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('$selectedDateKey has already been recorded.')),
      );
      return;
    }
    setState(() => _checkingAccess = false);
    await Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => DailySymptomScreen(
          profile: _profile,
          entryDate: selectedDate,
          maximumBackdateDays: _maximumBackdateDays,
        ),
      ),
    );

    if (mounted) await _loadStatus();
  }

  Future<void> _openSettings() async {
    await Navigator.push(
      context,
      MaterialPageRoute(builder: (_) => const SettingsScreen()),
    );
    if (mounted) await _loadStatus();
  }

  String get _firstName {
    final name = _profile.fullName.trim();
    if (name.isEmpty) return '';
    return name.split(RegExp(r'\s+')).first;
  }

  String _formatSync(DateTime? value) {
    if (value == null) return 'No successful upload yet';
    final local = value.toLocal();
    final hour = local.hour.toString().padLeft(2, '0');
    final minute = local.minute.toString().padLeft(2, '0');
    return '${local.day}/${local.month}/${local.year} at $hour:$minute';
  }

  String _checkInDateLabel(DateTime date, DateTime today) {
    final difference = DateTime.utc(
      today.year,
      today.month,
      today.day,
    ).difference(DateTime.utc(date.year, date.month, date.day)).inDays;
    final formatted = '${date.day}/${date.month}/${date.year}';
    if (difference == 0) return 'Today · $formatted';
    if (difference == 1) return 'Yesterday · $formatted';
    return formatted;
  }

  bool get _hasAvailableCheckInDate {
    final now = DateTime.now();
    return List.generate(
      _maximumBackdateDays + 1,
      (index) => DateTime(now.year, now.month, now.day - index),
    ).any(
      (date) => !_submittedDates.contains(StorageService.localDateKey(date)),
    );
  }

  @override
  Widget build(BuildContext context) {
    final greeting = _firstName.isEmpty ? 'Welcome' : 'Hello, $_firstName';

    return Scaffold(
      appBar: AppBar(
        title: const BrandAppBarTitle(),
        actions: [
          IconButton(
            tooltip: 'Settings',
            onPressed: _openSettings,
            icon: const Icon(Icons.settings),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(20, 18, 20, 32),
          children: [
            const BrandBanner(compact: true),
            const SizedBox(height: 24),
            Text(greeting, style: Theme.of(context).textTheme.headlineLarge),
            const SizedBox(height: 24),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(20),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Icon(
                          _completedToday
                              ? Icons.check_circle
                              : Icons.today_outlined,
                          size: 34,
                          color: _completedToday
                              ? AppTheme.successGreen
                              : AppTheme.primaryBlue,
                        ),
                        const SizedBox(width: 14),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                _completedToday
                                    ? 'Today’s check-in is complete'
                                    : 'Today’s check-in is ready',
                                key: const Key('daily-check-in-status'),
                                style: Theme.of(context).textTheme.titleLarge,
                              ),
                              const SizedBox(height: 8),
                              Text(
                                _completedToday
                                    ? 'You can still record a missed day from the previous $_maximumBackdateDays days.'
                                    : 'Record your symptoms and overall wellness when you are ready.',
                                style: Theme.of(context).textTheme.bodyLarge
                                    ?.copyWith(color: AppTheme.secondaryText),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 18),
                    if (_hasAvailableCheckInDate)
                      FilledButton.icon(
                        key: const Key('start-daily-check-in'),
                        onPressed: _loading || _checkingAccess
                            ? null
                            : _startCheckIn,
                        icon: _checkingAccess
                            ? const SizedBox.square(
                                dimension: 20,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2.5,
                                ),
                              )
                            : const Icon(Icons.edit_note),
                        label: const Text('Choose check-in date'),
                      )
                    else
                      const Row(
                        children: [
                          Icon(Icons.notifications_active_outlined, size: 20),
                          SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              'Every available date has already been recorded.',
                            ),
                          ),
                        ],
                      ),
                  ],
                ),
              ),
            ),
            Card(
              child: ListTile(
                leading: const Icon(Icons.history),
                title: const Text('Patient diary'),
                subtitle: const Text(
                  'View 30, 60 and 90 day wellness and symptom trends',
                ),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => Navigator.push(
                  context,
                  MaterialPageRoute(builder: (_) => const HistoryScreen()),
                ),
              ),
            ),
            Card(
              child: ListTile(
                leading: Icon(
                  _pendingUploads == 0 ? Icons.cloud_done : Icons.cloud_upload,
                ),
                title: Text(
                  _pendingUploads == 0
                      ? 'Synced'
                      : '$_pendingUploads upload(s) pending',
                ),
                subtitle: Text(
                  _pendingUploads == 0
                      ? 'Last successful sync: ${_formatSync(_lastSync)}'
                      : 'Pull down to retry the clinic connection.',
                ),
                trailing: const Icon(Icons.chevron_right),
                onTap: _openSettings,
              ),
            ),
            Card(
              child: ListTile(
                leading: const Icon(Icons.notifications_outlined),
                title: const Text('Daily reminder'),
                subtitle: Text(_profile.reminderTime.format(context)),
                trailing: const Icon(Icons.chevron_right),
                onTap: _openSettings,
              ),
            ),
            Text(
              'One check-in is available for each calendar day, including the previous $_maximumBackdateDays days. '
              'This app is for clinical monitoring and must not be used for emergencies.',
              textAlign: TextAlign.center,
              style: Theme.of(
                context,
              ).textTheme.bodyMedium?.copyWith(color: AppTheme.secondaryText),
            ),
          ],
        ),
      ),
    );
  }
}
