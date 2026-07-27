class ApiConfig {
  static const String baseUrl = String.fromEnvironment(
    'NEUROTRACKER_API_URL',
    defaultValue: 'https://tracker.melindapascoeneurology.com',
  );
}
