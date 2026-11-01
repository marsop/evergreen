# Changelog

Notable changes to Evergreen are documented here.

## [Unreleased]

### Added

- Installable PWA manifest and branded device icons, scoped integrity-checked offline assets, and root/subpath installation and update tests.
- Google sign-in and private per-account Firestore backing storage on Spark, with one-time sample initialization.
- Durable offline edits and published offline startup, explicit synchronization/failure status, and idempotent operation receipts.
- Bounded compressed journal photos in separate, unindexed Firestore documents without Cloud Storage or paid billing.
- Firebase ownership/schema rules, emulator and browser tests, and public configuration setup/deployment guidance.

- Repository contributor guidance and a Release build workflow.
- GitHub Pages deployment for the standalone WebAssembly app.
- English, Spanish, and German localization using `.resx` resources, browser-language detection, and a persistent language selector.
- Live language switching that preserves garden data and open forms, with localized care advice, journal content, dates, and accessibility text.
- Automated localization-resource, culture-selection, and browser-bootstrap tests.

### Changed

- Use stable record relationships and actual dated watering history; synchronize account language without losing open forms.

- Migrate from interactive server rendering to standalone Blazor WebAssembly for static hosting.
