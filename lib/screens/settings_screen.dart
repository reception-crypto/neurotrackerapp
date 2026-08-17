import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../app_identity.dart';
import '../models/patient_profile.dart';
import '../services/csv_service.dart';
import '../services/notification_service.dart';
import '../services/storage_service.dart';
import '../services/upload_service.dart';
import 'consent_screen.dart';
import 'enrolment_screen.dart';
import 'history_screen.dart';
import 'privacy_screen.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  String csv = '';
  int pending = 0;
  DateTime? lastSync;
  PatientProfile? profile;
  bool retrying = false;

  @override
  void initState() {
    super.initState();
    _loadStatus();
  }

  Future<void> _loadStatus() async {
    final loadedProfile = await StorageService.loadProfile();
    final loadedPending = await StorageService.pendingCount();
    final loadedLastSync = await StorageService.lastSuccessfulSync();
    if (!mounted) return;
    setState(() {
      profile = loadedProfile;
      pending = loadedPending;
      lastSync = loadedLastSync;
    });
  }

  Future<void> _loadCsv() async {
    final rows = await StorageService.loadEntries();
    if (!mounted) return;
    setState(() => csv = CsvService.buildCsv(rows));
  }

  Future<void> _retry() async {
    setState(() => retrying = true);
    final summary = await UploadService.retryPendingUploads();
    await _loadStatus();
    if (!mounted) return;
    setState(() => retrying = false);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          summary.alreadyRecorded > 0 && summary.remaining == 0
              ? '${summary.alreadyRecorded} queued check-in(s) were removed because the clinic already had an entry for those dates.'
              : summary.lastFailure == null
              ? '${summary.uploaded} pending check-in(s) synced.'
              : '${summary.uploaded} synced; ${summary.remaining} still pending. ${summary.lastFailure!.patientMessage}',
        ),
      ),
    );
  }

  Future<void> _changeReminder() async {
    final current =
        profile?.reminderTime ?? const TimeOfDay(hour: 19, minute: 0);
    final selected = await showTimePicker(
      context: context,
      initialTime: current,
    );
    if (selected == null || profile == null) return;
    final updated = profile!.copyWith(reminderTime: selected);
    await StorageService.saveProfile(updated);
    final completedToday = await StorageService.hasSubmittedToday();
    await NotificationService.scheduleDailyReminder(
      hour: selected.hour,
      minute: selected.minute,
      skipToday: completedToday,
    );
    if (!mounted) return;
    setState(() => profile = updated);
  }

  Future<void> _reset() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Reset app?'),
        content: const Text(
          'This removes the saved profile, clinic enrolment, and local check-in history from this phone. A new one-time clinic code will be required before the app can be used again.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Reset'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    await StorageService.resetAll();
    if (!mounted) return;
    Navigator.pushAndRemoveUntil(
      context,
      MaterialPageRoute(builder: (_) => const ConsentScreen()),
      (_) => false,
    );
  }

  String _formatSync(DateTime? value) {
    if (value == null) return 'No successful upload yet';
    final local = value.toLocal();
    return '${local.day}/${local.month}/${local.year} '
        '${local.hour.toString().padLeft(2, '0')}:'
        '${local.minute.toString().padLeft(2, '0')}';
  }

  Future<void> _copySupportId() async {
    final supportId = profile?.supportId;
    if (supportId == null) return;
    await Clipboard.setData(ClipboardData(text: supportId));
    if (!mounted) return;
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(const SnackBar(content: Text('Support ID copied.')));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Text(
            'Sync status',
            style: Theme.of(context).textTheme.headlineMedium,
          ),
          const SizedBox(height: 12),
          Card(
            child: ListTile(
              leading: Icon(
                pending == 0 ? Icons.cloud_done : Icons.cloud_upload,
              ),
              title: Text(
                pending == 0 ? 'Synced' : '$pending upload(s) pending',
              ),
              subtitle: Text('Last successful sync: ${_formatSync(lastSync)}'),
              trailing: pending > 0
                  ? IconButton(
                      onPressed: retrying ? null : _retry,
                      icon: retrying
                          ? const SizedBox.square(
                              dimension: 22,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.refresh),
                    )
                  : null,
            ),
          ),
          const SizedBox(height: 12),
          Card(
            child: ListTile(
              leading: const Icon(Icons.notifications),
              title: const Text('Daily reminder'),
              subtitle: Text(
                profile == null
                    ? 'Not configured'
                    : profile!.reminderTime.format(context),
              ),
              onTap: _changeReminder,
            ),
          ),
          const SizedBox(height: 12),
          Card(
            child: ListTile(
              leading: const Icon(Icons.history),
              title: const Text('Check-in history'),
              subtitle: const Text('Review entries saved on this device'),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => Navigator.push(
                context,
                MaterialPageRoute(builder: (_) => const HistoryScreen()),
              ),
            ),
          ),
          const SizedBox(height: 12),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Icon(Icons.assignment_ind_outlined),
                  const SizedBox(width: 16),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Clinic-assigned profile',
                          style: Theme.of(context).textTheme.titleMedium,
                        ),
                        const SizedBox(height: 4),
                        Text(
                          profile == null
                              ? 'Profile unavailable'
                              : '${profile!.settingsSummary}'
                                    '\nProfile revision ${profile!.profileRevision}. Contact the clinic to request changes.',
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),
          Card(
            child: ListTile(
              leading: const Icon(Icons.verified_user_outlined),
              title: const Text('Clinic enrolment'),
              subtitle: Text(
                profile == null
                    ? 'Not enrolled'
                    : 'Support ID: ${profile!.supportId}\nTap to copy',
              ),
              trailing: PopupMenuButton<String>(
                tooltip: 'Clinic enrolment options',
                onSelected: (value) async {
                  if (value == 'copy') {
                    await _copySupportId();
                  } else if (value == 'replace' && profile != null && mounted) {
                    await Navigator.push(
                      context,
                      MaterialPageRoute(
                        builder: (_) =>
                            EnrolmentScreen(existingProfile: profile),
                      ),
                    );
                  }
                },
                itemBuilder: (_) => const [
                  PopupMenuItem(value: 'copy', child: Text('Copy support ID')),
                  PopupMenuItem(
                    value: 'replace',
                    child: Text('Enter a new enrolment code'),
                  ),
                ],
              ),
              onTap: _copySupportId,
            ),
          ),
          const SizedBox(height: 20),
          Text(
            'App information',
            style: Theme.of(context).textTheme.headlineMedium,
          ),
          const SizedBox(height: 12),
          const Card(
            child: ListTile(
              leading: Icon(Icons.info_outline),
              title: Text(appDisplayName),
              subtitle: Text(
                'Version $appVersionLabel\nFor clinical monitoring; not for emergency use.',
              ),
            ),
          ),
          const SizedBox(height: 12),
          Card(
            child: ListTile(
              leading: const Icon(Icons.privacy_tip_outlined),
              title: const Text('Privacy and app information'),
              subtitle: const Text(
                'How information is handled, support, and medical disclaimer',
              ),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => Navigator.push(
                context,
                MaterialPageRoute(builder: (_) => const PrivacyScreen()),
              ),
            ),
          ),
          const SizedBox(height: 20),
          ExpansionTile(
            title: const Text('Testing and local data'),
            children: [
              Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 8,
                ),
                child: Column(
                  children: [
                    SizedBox(
                      width: double.infinity,
                      child: FilledButton(
                        onPressed: _loadCsv,
                        child: const Text('Show local CSV'),
                      ),
                    ),
                    const SizedBox(height: 12),
                    SizedBox(
                      width: double.infinity,
                      child: OutlinedButton(
                        onPressed: _reset,
                        child: const Text('Reset app'),
                      ),
                    ),
                    if (csv.isNotEmpty) ...[
                      const SizedBox(height: 16),
                      SelectableText(csv),
                    ],
                  ],
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
