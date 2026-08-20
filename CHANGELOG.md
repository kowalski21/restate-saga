# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- Upgraded Restate TypeScript SDK support to 1.16.7.
- `workflowClient` and `workflowSendClient` support keyed Restate Workflows with a workflow ID while preserving the legacy two-argument service-style call.
- Added scoped clients, signal/invocation helpers, journal-mismatch handling, workflow retention, lazy state, and service metadata.

## [0.3.0] - 2026-02-09

### Added
- Scoped saga factory pattern with `defineSagaFactory` for per-invocation scoped containers
- Scope disposal strategies (`true`, `false`, `"on-success"`, custom function)
- Factory type inference helpers (`InferFactory`, `InferFactoryServiceType`, etc.)
- Saga factory example (`examples/09-saga-factory.ts`)

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
