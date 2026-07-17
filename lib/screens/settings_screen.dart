import 'package:flutter/material.dart';

import '../models/patient_profile.dart';
import '../services/csv_service.dart';
import '../services/notification_service.dart';
import '../services/storage_service.dart';
import '../services/upload_service.dart';
import 'consent_screen.dart';
import 'history_screen.dart';
import 'profile_screen.dart';

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
    final uploaded = await UploadService.retryPendingUploads();
    await _loadStatus();
    if (!mounted) return;
    setState(() => retrying = false);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('$uploaded pending check-in(s) synced.')),
    );
  }

  Future<void> _changeReminder() async {
    final current = profile?.reminderTime ?? const TimeOfDay(hour: 19, minute: 0);
    final selected = await showTimePicker(context: context, initialTime: current);
    if (selected == null || profile == null) return;
    final updated = profile!.copyWith(reminderTime: selected);
    await StorageService.saveProfile(updated);
    await NotificationService.scheduleDailyReminder(
  hour: selected.hour,
  minute: selected.minute,
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
          'This removes the saved profile and local check-in history from this phone.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.pop(context, true), child: const Text('Reset')),
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

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Text('Sync status', style: Theme.of(context).textTheme.headlineMedium),
          const SizedBox(height: 12),
          Card(
            child: ListTile(
              leading: Icon(pending == 0 ? Icons.cloud_done : Icons.cloud_upload),
              title: Text(pending == 0 ? 'Synced' : '$pending upload(s) pending'),
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
              subtitle: Text(profile == null
                  ? 'Not configured'
                  : profile!.reminderTime.format(context)),
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
            child: ListTile(
              leading: const Icon(Icons.manage_accounts),
              title: const Text('Edit patient profile'),
              subtitle: Text(
                profile == null
                    ? 'Profile unavailable'
                    : '${profile!.primaryDisorder}${profile!.hasSecondaryDisorder ? ' and ${profile!.secondaryDisorder}' : ''}',
              ),
              trailing: const Icon(Icons.chevron_right),
              onTap: profile == null
                  ? null
                  : () => Navigator.push(
                        context,
                        MaterialPageRoute(
                          builder: (_) => ProfileScreen(initialProfile: profile),
                        ),
                      ),
            ),
          ),
          const SizedBox(height: 20),
          Text('App information', style: Theme.of(context).textTheme.headlineMedium),
          const SizedBox(height: 12),
          const Card(
            child: ListTile(
              leading: Icon(Icons.info_outline),
              title: Text('NeuroTracker Clinical'),
              subtitle: Text('Version 1.0.0\nFor clinical monitoring; not for emergency use.'),
            ),
          ),
          const SizedBox(height: 20),
          ExpansionTile(
            title: const Text('Testing and local data'),
            children: [
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                child: Column(
                  children: [
                    SizedBox(
                      width: double.infinity,
                      child: FilledButton(onPressed: _loadCsv, child: const Text('Show local CSV')),
                    ),
                    const SizedBox(height: 12),
                    SizedBox(
                      width: double.infinity,
                      child: OutlinedButton(onPressed: _reset, child: const Text('Reset app')),
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
