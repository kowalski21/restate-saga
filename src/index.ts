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
  InferServiceType,
  InferObjectType,
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

// Container / Dependency Injection (Awilix)
export type {
  ContainerSagaContext,
  ContainerWorkflowContext,
  AnyContainerSagaContext,
  ContainerStepConfig,
  ContainerWorkflowService,
  ContainerRestateWorkflowService,
  // Type inference helpers (for createContainerWorkflow)
  InferContainerServiceType,
  InferContainerCradle,
  InferContainerInput,
  InferContainerOutput,
  InferContainerName,
  InferContainerWorkflow,
  // Type inference helpers (for defineContainerWorkflow factory pattern)
  InferFactoryWorkflow,
  InferFactoryServiceType,
  InferFactoryInput,
  InferFactoryOutput,
  InferFactoryName,
  InferFactoryCradle,
  InferFactory,
} from "./container.js";
export {
  createContainerStep,
  createContainerStepStrict,
  createContainerWorkflow,
  createContainerRestateWorkflow,
  defineContainerWorkflow,
  defineContainerRestateWorkflow,
} from "./container.js";
