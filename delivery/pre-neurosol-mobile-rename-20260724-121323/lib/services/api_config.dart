class ApiConfig {
  static const String baseUrl = String.fromEnvironment(
    'NEUROTRACKER_API_URL',
    defaultValue: 'http://tracker.melindapascoeneurology.com',
  );

  static const String apiKey = String.fromEnvironment(
    'NEUROTRACKER_API_KEY',
    defaultValue: 'change-this-long-random-api-key',
  );
}
