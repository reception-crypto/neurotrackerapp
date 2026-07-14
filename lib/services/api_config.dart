class ApiConfig {
  static const String baseUrl = String.fromEnvironment(
    'NEUROTRACKER_API_URL',
    defaultValue: 'http://192.168.1.15:3000',
  );

  static const String apiKey = String.fromEnvironment(
    'NEUROTRACKER_API_KEY',
    defaultValue: 'change-this-long-random-api-key',
  );
}
