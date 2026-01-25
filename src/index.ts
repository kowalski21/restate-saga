/**
 * restate-saga - Saga pattern implementation for Restate durable workflows
 *
 * @packageDocumentation
 */

// Types
export type {
  SagaContext,
  SagaStep,
  Duration,
  StepRetryPolicy,
  WorkflowRetryPolicy,
  ErrorMapper,
  ErrorClass,
  SagaWorkflowOptions,
  SagaStepOptions,
  SagaRestateWorkflowOptions,
  SagaWorkflowContext,
  SagaObjectContext,
  SagaVirtualObjectOptions,
  SagaObjectHandler,
  AnySagaContext,
} from "./types.js";

// Error Registry
export {
  registerTerminalErrors,
  unregisterTerminalErrors,
  clearTerminalErrors,
  setGlobalErrorMapper,
  getGlobalErrorMapper,
  resolveTerminalError,
} from "./error-registry.js";

// Steps
export { StepResponse, createSagaStep, createSagaStepStrict } from "./steps.js";

// Workflows
export type { SagaWorkflowService, SagaRestateWorkflowService } from "./workflows.js";
export { createSagaWorkflow, createSagaRestateWorkflow } from "./workflows.js";

// Virtual Objects
export { createSagaVirtualObject } from "./virtual-objects.js";

// Client Helpers
export type { WorkflowInput, WorkflowOutput } from "./clients.js";
export {
  workflowClient,
  workflowSendClient,
  serviceClient,
  serviceSendClient,
  objectClient,
  objectSendClient,
} from "./clients.js";

// Nested Sagas
export { runNestedSaga, createSagaModule } from "./nested.js";
