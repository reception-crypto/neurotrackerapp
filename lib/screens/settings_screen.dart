import 'package:flutter/material.dart';

import '../services/csv_service.dart';
import '../services/storage_service.dart';
import 'consent_screen.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  String csv = '';

  Future<void> _loadCsv() async {
    final rows = await StorageService.loadEntries();
    setState(() => csv = CsvService.buildCsv(rows));
  }

  Future<void> _reset() async {
    await StorageService.resetAll();
    if (!mounted) return;
    Navigator.pushAndRemoveUntil(
      context,
      MaterialPageRoute(builder: (_) => const ConsentScreen()),
      (_) => false,
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Testing Tools', style: Theme.of(context).textTheme.headlineMedium),
            const SizedBox(height: 20),
            FilledButton(onPressed: _loadCsv, child: const Text('Show CSV')),
            const SizedBox(height: 12),
            FilledButton(onPressed: _reset, child: const Text('Reset App')),
            const SizedBox(height: 20),
            Expanded(
              child: SingleChildScrollView(
                child: SelectableText(csv),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
