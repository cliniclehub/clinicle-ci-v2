# Clinicle CMS Mobile

Flutter foundation for the Clinicle CMS mobile application. It follows the
shared LMS mobile setup without importing LMS-specific screens, business logic,
branding, signing configuration, or generated build artifacts.

## Included

- Riverpod application state and dependency injection
- GoRouter navigation
- Dio API client with environment-configurable base URL
- Material 3 light and dark themes
- English and Arabic localization foundation
- Freezed and JSON code-generation dependencies

## Local development

```sh
flutter pub get
flutter run --dart-define=API_BASE_URL=http://localhost:8000/api/v1
flutter analyze
flutter test
```

For Android emulators, use `http://10.0.2.2:8000/api/v1` when the backend runs
on the host Mac.
