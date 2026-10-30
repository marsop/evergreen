# Changelog

Notable changes to Evergreen are documented here.

## [Unreleased]

### Added

- Repository contributor guidance and a Release build workflow.
- GitHub Pages deployment for the standalone WebAssembly app.
- English, Spanish, and German localization using `.resx` resources, browser-language detection, and a persistent language selector.
- Live language switching that preserves garden data and open forms, with localized care advice, journal content, dates, and accessibility text.
- Automated localization-resource, culture-selection, and browser-bootstrap tests.

### Changed

- Migrate from interactive server rendering to standalone Blazor WebAssembly for static hosting.
