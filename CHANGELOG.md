# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-02-02

### Added
- Dependency injection support with Awilix container integration
- Factory type inference helpers

### Changed
- Improved type safety and removed `as any` casts

## [0.1.0] - 2026-01-25

### Added
- Initial release of `@kowalski21/restate-saga`
- Saga pattern implementation for Restate durable workflows
- Automatic compensation handling for failed workflows
- Step-based workflow definition with `addStep()`
- Support for calling Restate services from saga workflows
- `InferServiceType` helper for SDK client compatibility
- Literal workflow name type preservation for type-safe client usage
- Unit and integration tests
- Example usage files
- Documentation for external client usage
