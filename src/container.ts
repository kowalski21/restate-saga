import * as restate from "@restatedev/restate-sdk";
import type { AwilixContainer } from "awilix";
import type {
  SagaContext,
  SagaWorkflowContext,
  SagaStepOptions,
  SagaWorkflowOptions,
  SagaRestateWorkflowOptions,
  StepRetryPolicy,
  WorkflowRetryPolicy,
  AnySagaContext,
  RestateRunOptions,
} from "./types.js";
import { StepResponse } from "./steps.js";
import { resolveTerminalError } from "./error-registry.js";

/**
 * Extended saga context that includes resolved container services.
 * Steps and workflows receive this context with `services` already populated.
 *
 * @property services - The container's cradle (direct property access)
 * @property container - The full Awilix container (for .resolve() calls)
 */
export type ContainerSagaContext<
  TCradle extends object,
  TContainer = AwilixContainer<TCradle>
> = SagaContext & {
  /** Direct access to resolved services via cradle proxy */
  services: TCradle;
  /** Full container for dynamic resolution via .resolve() */
  container: TContainer;
};

/**
 * Extended workflow saga context with resolved container services.
 */
export type ContainerWorkflowContext<
  TCradle extends object,
  TContainer = AwilixContainer<TCradle>
> = SagaWorkflowContext & {
  services: TCradle;
  container: TContainer;
};

/**
 * Any container saga context type (for runAsStep compatibility).
 */
export type AnyContainerSagaContext<
  TCradle extends object,
  TContainer = AwilixContainer<TCradle>
> = AnySagaContext & {
  services: TCradle;
  container: TContainer;
};

// =============================================================================
// Type Inference Helpers
// =============================================================================

/**
 * Extracts the Restate service type from a ContainerWorkflowService.
 *
 * Use this when you need a type compatible with the Restate SDK client's
 * `serviceClient<T>({ name: "..." })` pattern.
 *
 * @example
 * ```typescript
 * const orderWorkflow = createContainerWorkflow(container, "OrderWorkflow", handler);
 * type OrderWorkflowService = InferContainerServiceType<typeof orderWorkflow>;
 *
 * // In client code:
 * const result = await client
 *   .serviceClient<OrderWorkflowService>({ name: "OrderWorkflow" })
 *   .run(input);
 * ```
 */
export type InferContainerServiceType<T> = T extends {
  handlers: infer H;
  name: infer N extends string;
}
  ? restate.ServiceDefinition<N, H>
  : never;

/**
 * Extracts the TCradle (services) type from a ContainerWorkflowService.
 *
 * Use this to ensure type compatibility between containers and workflows.
 *
 * @example
 * ```typescript
 * const orderWorkflow = createContainerWorkflow(container, "OrderWorkflow", handler);
 * type RequiredServices = InferContainerCradle<typeof orderWorkflow>;
 *
 * // Ensure container has required services:
 * function createWorkflow(container: AwilixContainer<RequiredServices>) {
 *   return createContainerWorkflow(container, "OrderWorkflow", handler);
 * }
 * ```
 */
export type InferContainerCradle<T> = T extends {
  runAsStep: (parentSaga: AnyContainerSagaContext<infer TCradle>, input: any) => Promise<any>;
}
  ? TCradle
  : never;

/**
 * Extracts the Input type from a ContainerWorkflowService.
 *
 * @example
 * ```typescript
 * const orderWorkflow = createContainerWorkflow(container, "OrderWorkflow", handler);
 * type OrderInput = InferContainerInput<typeof orderWorkflow>;
 *
 * const input: OrderInput = { userId: "123", items: [] };
 * ```
 */
export type InferContainerInput<T> = T extends {
  handlers: { run: (ctx: any, input: infer I) => Promise<any> };
}
  ? I
  : never;

/**
 * Extracts the Output type from a ContainerWorkflowService.
 *
 * @example
 * ```typescript
 * const orderWorkflow = createContainerWorkflow(container, "OrderWorkflow", handler);
 * type OrderOutput = InferContainerOutput<typeof orderWorkflow>;
 *
 * const result: OrderOutput = await client.serviceClient(orderWorkflow).run(input);
 * ```
 */
export type InferContainerOutput<T> = T extends {
  handlers: { run: (ctx: any, input: any) => Promise<infer O> };
}
  ? O
  : never;

/**
 * Extracts the workflow name from a ContainerWorkflowService.
 *
 * @example
 * ```typescript
 * const orderWorkflow = createContainerWorkflow(container, "OrderWorkflow", handler);
 * type WorkflowName = InferContainerName<typeof orderWorkflow>; // "OrderWorkflow"
 * ```
 */
export type InferContainerName<T> = T extends { name: infer N extends string } ? N : never;

/**
 * Utility type that extracts all type information from a ContainerWorkflowService.
 *
 * @example
 * ```typescript
 * const orderWorkflow = createContainerWorkflow(container, "OrderWorkflow", handler);
 * type Info = InferContainerWorkflow<typeof orderWorkflow>;
 *
 * // Info.Name = "OrderWorkflow"
 * // Info.Input = { userId: string; items: any[] }
 * // Info.Output = { orderId: string }
 * // Info.Cradle = AppServices
 * // Info.ServiceType = restate.ServiceDefinition<"OrderWorkflow", ...>
 * ```
 */
export type InferContainerWorkflow<T> = {
  Name: InferContainerName<T>;
  Input: InferContainerInput<T>;
  Output: InferContainerOutput<T>;
  Cradle: InferContainerCradle<T>;
  ServiceType: InferContainerServiceType<T>;
};

// =============================================================================
// Factory Type Inference Helpers
// =============================================================================

/**
 * Extracts the workflow instance type from a factory function created by
 * `defineContainerWorkflow` or `defineContainerRestateWorkflow`.
 *
 * @example
 * ```typescript
 * const createOrderWorkflow = defineContainerWorkflow<AppServices>()(
 *   "OrderWorkflow",
 *   async (saga, input) => { ... }
 * );
 *
 * // Extract the instantiated workflow type
 * type OrderWorkflowInstance = InferFactoryWorkflow<typeof createOrderWorkflow>;
 * ```
 */
export type InferFactoryWorkflow<T> = T extends (container: any) => infer W ? W : never;

/**
 * Extracts the Restate service type from a factory function for use with
 * `serviceClient<T>({ name: "..." })`.
 *
 * This is the primary type helper for calling factory-defined workflows from clients.
 *
 * @example
 * ```typescript
 * // Define workflow with factory pattern
 * const createOrderWorkflow = defineContainerWorkflow<AppServices>()(
 *   "OrderWorkflow",
 *   async (saga, input: OrderInput): Promise<OrderOutput> => { ... }
 * );
 *
 * // Export the service type for clients
 * export type OrderWorkflow = InferFactoryServiceType<typeof createOrderWorkflow>;
 *
 * // In client code:
 * const result = await restateClient
 *   .serviceClient<OrderWorkflow>({ name: "OrderWorkflow" })
 *   .run({ userId: "123", items: [] });
 * ```
 */
export type InferFactoryServiceType<T> = InferContainerServiceType<InferFactoryWorkflow<T>>;

/**
 * Extracts the Input type from a factory function.
 *
 * @example
 * ```typescript
 * const createOrderWorkflow = defineContainerWorkflow<AppServices>()(...);
 * type OrderInput = InferFactoryInput<typeof createOrderWorkflow>;
 * ```
 */
export type InferFactoryInput<T> = InferContainerInput<InferFactoryWorkflow<T>>;

/**
 * Extracts the Output type from a factory function.
 *
 * @example
 * ```typescript
 * const createOrderWorkflow = defineContainerWorkflow<AppServices>()(...);
 * type OrderOutput = InferFactoryOutput<typeof createOrderWorkflow>;
 * ```
 */
export type InferFactoryOutput<T> = InferContainerOutput<InferFactoryWorkflow<T>>;

/**
 * Extracts the workflow name from a factory function.
 *
 * @example
 * ```typescript
 * const createOrderWorkflow = defineContainerWorkflow<AppServices>()(...);
 * type Name = InferFactoryName<typeof createOrderWorkflow>; // "OrderWorkflow"
 * ```
 */
export type InferFactoryName<T> = InferContainerName<InferFactoryWorkflow<T>>;

/**
 * Extracts the TCradle (services) type from a factory function.
 *
 * @example
 * ```typescript
 * const createOrderWorkflow = defineContainerWorkflow<AppServices>()(...);
 * type Services = InferFactoryCradle<typeof createOrderWorkflow>; // AppServices
 * ```
 */
export type InferFactoryCradle<T> = InferContainerCradle<InferFactoryWorkflow<T>>;

/**
 * Utility type that extracts all type information from a factory function.
 *
 * @example
 * ```typescript
 * const createOrderWorkflow = defineContainerWorkflow<AppServices>()(...);
 * type Info = InferFactory<typeof createOrderWorkflow>;
 *
 * // Info.Name = "OrderWorkflow"
 * // Info.Input = { userId: string; items: any[] }
 * // Info.Output = { orderId: string }
 * // Info.Cradle = AppServices
 * // Info.ServiceType = restate.ServiceDefinition<"OrderWorkflow", ...>
 * ```
 */
export type InferFactory<T> = InferContainerWorkflow<InferFactoryWorkflow<T>>;

/**
 * Convert StepRetryPolicy to Restate RunOptions format.
 * @internal
 */
function toRunOptions(policy?: StepRetryPolicy): RestateRunOptions | undefined {
  if (!policy) return undefined;

  return {
    maxRetryAttempts: policy.maxRetryAttempts,
    maxRetryDuration: policy.maxRetryDuration,
    initialRetryInterval: policy.initialRetryInterval,
    retryIntervalFactor: policy.retryIntervalFactor,
    maxRetryInterval: policy.maxRetryInterval,
  };
}

/**
 * Helper to call ctx.run with optional run options.
 * This avoids TypeScript issues with passing undefined as the third parameter.
 * @internal
 */
async function runWithOptions<T>(
  ctx: restate.Context,
  name: string,
  fn: () => Promise<T>,
  options?: RestateRunOptions
): Promise<T> {
  if (options) {
    return ctx.run(name, fn, options);
  }
  return ctx.run(name, fn);
}

/**
 * Convert WorkflowRetryPolicy to Restate service options format.
 * @internal
 */
function toServiceRetryPolicy(policy?: WorkflowRetryPolicy): object | undefined {
  if (!policy) return undefined;

  return {
    maxAttempts: policy.maxAttempts,
    onMaxAttempts: policy.onMaxAttempts,
    initialInterval: policy.initialInterval,
    exponentiationFactor: policy.exponentiationFactor,
    maxInterval: policy.maxInterval,
  };
}

/**
 * Configuration for a container-aware saga step.
 */
export type ContainerStepConfig<TCradle extends object, Input, Output, CompensationData> = {
  /** Unique name for this step (used in logs and compensation tracking) */
  name: string;
  /** Optional step configuration (retry policies, error mapping) */
  options?: SagaStepOptions;
  /**
   * The forward action to execute.
   * Receives saga context with services and the step input.
   */
  run: (
    saga: ContainerSagaContext<TCradle>,
    input: Input
  ) => Promise<StepResponse<Output, CompensationData>>;
  /**
   * Optional compensation function to undo the step's effects.
   * Receives saga context with services and the compensation data.
   * If not provided, no rollback action is registered.
   */
  compensate?: (
    saga: ContainerSagaContext<TCradle>,
    data: CompensationData | Input,
    context: { failed: boolean }
  ) => Promise<void>;
};

/**
 * Creates a container-aware saga step with dependency injection.
 *
 * Unlike `createSagaStep`, this version:
 * - Receives `saga.services` with resolved dependencies from the container
 * - Both `run` and `compensate` have access to services
 * - No need to pass container or services around manually
 *
 * @example
 * ```typescript
 * // Define your services type
 * interface AppServices {
 *   ordersService: ItemsService;
 *   inventoryService: ItemsService;
 *   database: Knex;
 * }
 *
 * // Create a step - services are available on saga.services
 * const createOrder = createContainerStep<AppServices>()({
 *   name: "CreateOrder",
 *   run: async (saga, input: { userId: string; items: any[] }) => {
 *     const orderId = await saga.services.ordersService.createOne({
 *       user: input.userId,
 *       items: input.items,
 *     });
 *     return new StepResponse({ orderId }, { orderId });
 *   },
 *   compensate: async (saga, data) => {
 *     // saga.services is available here too!
 *     if ("orderId" in data) {
 *       await saga.services.ordersService.deleteOne(data.orderId);
 *     }
 *   },
 * });
 *
 * // Use in a container workflow - services are injected automatically
 * const workflow = createContainerWorkflow(container, "OrderWorkflow", async (saga, input) => {
 *   const order = await createOrder(saga, input);
 *   return order;
 * });
 * ```
 */
export function createContainerStep<TCradle extends object>() {
  return function <Input, Output, CompensationData = Input>(
    config: ContainerStepConfig<TCradle, Input, Output, CompensationData>
  ) {
    // Pre-compute run options for performance
    const runOptions = toRunOptions(config.options?.retry);
    const compensationRunOptions = toRunOptions(
      config.options?.compensationRetry ?? config.options?.retry
    );
    const errorMapper = config.options?.asTerminalError;

    return async (saga: ContainerSagaContext<TCradle>, input: Input): Promise<Output> => {
      const { ctx, compensations, services } = saga;

      // Track step state
      let stepFailed = true;
      let compensationData: CompensationData | undefined;

      // 1️⃣ Register compensation FIRST (runs even if step fails) - only if compensate is provided
      if (config.compensate) {
        const compensateFn = config.compensate;
        compensations.push(async () => {
          const data = compensationData !== undefined ? compensationData : input;
          await runWithOptions(
            ctx,
            `compensate:${config.name}`,
            // Compensation also gets the saga context with services
            () => compensateFn(saga, data as CompensationData | Input, { failed: stepFailed }),
            compensationRunOptions
          );
        });
      }

      // 2️⃣ Execute forward action with retry options and error mapping
      const response = await runWithOptions(
        ctx,
        config.name,
        async () => {
          try {
            return await config.run(saga, input);
          } catch (err) {
            const terminalError = resolveTerminalError(err, errorMapper);
            if (terminalError) {
              throw terminalError;
            }
            throw err;
          }
        },
        runOptions
      );

      // 3️⃣ Capture compensation data
      compensationData = response.compensationData;

      // 4️⃣ Check if step returned permanentFailure
      if (response.failed) {
        throw new restate.TerminalError(response.errorMessage || "Step failed permanently");
      }

      // 5️⃣ Mark as succeeded
      stepFailed = false;

      return response.output;
    };
  };
}

/**
 * Creates a container-aware strict saga step.
 *
 * Key behaviors:
 * - Compensation ONLY runs if step completed successfully
 * - Both `run` and `compensate` have access to `saga.services`
 * - Does NOT support permanentFailure (use createContainerStep for that)
 *
 * @example
 * ```typescript
 * const createOrder = createContainerStepStrict<AppServices>()({
 *   name: "CreateOrder",
 *   run: async (saga, input) => {
 *     const order = await saga.services.ordersService.createOne(input);
 *     return new StepResponse({ orderId: order.id }, { orderId: order.id });
 *   },
 *   compensate: async (saga, data) => {
 *     await saga.services.ordersService.deleteOne(data.orderId);
 *   },
 * });
 * ```
 */
export function createContainerStepStrict<TCradle extends object>() {
  return function <Input, Output, CompensationData>(config: {
    name: string;
    options?: SagaStepOptions;
    run: (
      saga: ContainerSagaContext<TCradle>,
      input: Input
    ) => Promise<StepResponse<Output, CompensationData>>;
    compensate?: (saga: ContainerSagaContext<TCradle>, data: CompensationData) => Promise<void>;
  }) {
    const runOptions = toRunOptions(config.options?.retry);
    const compensationRunOptions = toRunOptions(
      config.options?.compensationRetry ?? config.options?.retry
    );
    const errorMapper = config.options?.asTerminalError;

    return async (saga: ContainerSagaContext<TCradle>, input: Input): Promise<Output> => {
      const { ctx, compensations } = saga;

      // 1️⃣ Execute forward action FIRST
      const response = await runWithOptions(
        ctx,
        config.name,
        async () => {
          try {
            return await config.run(saga, input);
          } catch (err) {
            const terminalError = resolveTerminalError(err, errorMapper);
            if (terminalError) {
              throw terminalError;
            }
            throw err;
          }
        },
        runOptions
      );

      // 2️⃣ If permanentFailure, throw without registering compensation
      if (response.failed) {
        throw new restate.TerminalError(response.errorMessage || "Step failed permanently");
      }

      // 3️⃣ Register compensation AFTER success - only if compensate is provided
      if (config.compensate) {
        const compensateFn = config.compensate;
        compensations.push(() =>
          runWithOptions(
            ctx,
            `compensate:${config.name}`,
            () => compensateFn(saga, response.compensationData),
            compensationRunOptions
          )
        );
      }

      return response.output;
    };
  };
}

/**
 * Return type for createContainerWorkflow.
 */
export type ContainerWorkflowService<Name extends string, Input, Output, TCradle extends object> = {
  name: Name;
  handlers: {
    run: (ctx: restate.Context, input: Input) => Promise<Output>;
  };
  /**
   * Run this workflow as a step in a parent container saga.
   * Compensations join the parent's compensation stack.
   */
  runAsStep: (parentSaga: AnyContainerSagaContext<TCradle>, input: Input) => Promise<Output>;
};

/**
 * Creates a container-aware saga workflow with automatic dependency injection.
 *
 * The container's cradle is resolved once when the workflow starts, and all
 * steps automatically receive `saga.services` with the resolved dependencies.
 *
 * @param container - Awilix container with registered dependencies
 * @param name - The service name for this workflow
 * @param handler - The workflow handler that executes steps
 * @param options - Optional service-level configuration
 *
 * @example
 * ```typescript
 * import { createContainer, asValue, asClass } from "awilix";
 *
 * // 1. Define your services type
 * interface AppServices {
 *   ordersService: ItemsService;
 *   inventoryService: ItemsService;
 *   database: Knex;
 * }
 *
 * // 2. Create and configure container (e.g., in Directus extension)
 * const container = createContainer<AppServices>();
 * container.register({
 *   ordersService: asValue(new ItemsService("orders", { schema, accountability, knex })),
 *   inventoryService: asValue(new ItemsService("inventory", { schema, accountability, knex })),
 *   database: asValue(knex),
 * });
 *
 * // 3. Define steps using createContainerStep
 * const createOrder = createContainerStep<AppServices>()({ ... });
 * const reserveInventory = createContainerStep<AppServices>()({ ... });
 *
 * // 4. Create workflow - container injected once, available everywhere
 * const orderWorkflow = createContainerWorkflow(
 *   container,
 *   "OrderWorkflow",
 *   async (saga, input: { userId: string; items: any[] }) => {
 *     // saga.services.ordersService, saga.services.inventoryService available
 *     const order = await createOrder(saga, input);
 *     const inventory = await reserveInventory(saga, { orderId: order.orderId, items: input.items });
 *     return { order, inventory };
 *   }
 * );
 *
 * // 5. Register with Restate
 * restate.endpoint().bind(orderWorkflow).listen();
 * ```
 */
export function createContainerWorkflow<TCradle extends object, Name extends string, Input, Output>(
  container: AwilixContainer<TCradle>,
  name: Name,
  handler: (saga: ContainerSagaContext<TCradle>, input: Input) => Promise<Output>,
  options?: SagaWorkflowOptions
): ContainerWorkflowService<Name, Input, Output, TCradle> {
  // Build service options
  const serviceOptions = options
    ? {
        retryPolicy: toServiceRetryPolicy(options.retryPolicy),
        idempotencyRetention: options.idempotencyRetention,
        journalRetention: options.journalRetention,
        inactivityTimeout: options.inactivityTimeout,
        abortTimeout: options.abortTimeout,
        ingressPrivate: options.ingressPrivate,
        asTerminalError: options.asTerminalError,
      }
    : undefined;

  const service = restate.service({
    name,
    handlers: {
      run: async (ctx: restate.Context, input: Input) => {
        // Resolve cradle once per workflow invocation
        const services = container.cradle;

        const saga: ContainerSagaContext<TCradle, typeof container> = {
          ctx,
          compensations: [],
          services,
          container,
        };

        try {
          return await handler(saga, input);
        } catch (e) {
          if (e instanceof restate.TerminalError) {
            for (const compensate of saga.compensations.reverse()) {
              await compensate();
            }
          }
          throw e;
        }
      },
    },
    options: serviceOptions,
  });

  return Object.assign(service, {
    runAsStep: (parentSaga: AnyContainerSagaContext<TCradle>, input: Input): Promise<Output> => {
      return handler(parentSaga as ContainerSagaContext<TCradle>, input);
    },
  }) as ContainerWorkflowService<Name, Input, Output, TCradle>;
}

/**
 * Return type for createContainerRestateWorkflow.
 */
export type ContainerRestateWorkflowService<Name extends string, Input, Output, TCradle extends object> = {
  name: Name;
  handlers: {
    run: (ctx: restate.WorkflowContext, input: Input) => Promise<Output>;
  };
  runAsStep: (parentSaga: ContainerWorkflowContext<TCradle>, input: Input) => Promise<Output>;
};

/**
 * Creates a container-aware Restate Workflow with saga pattern support.
 *
 * Similar to `createContainerWorkflow` but for long-running Restate Workflows
 * with workflowId-based deduplication and optional signal/query handlers.
 *
 * @param container - Awilix container with registered dependencies
 * @param name - The workflow name
 * @param run - The main workflow handler with saga support
 * @param handlers - Optional additional handlers (signals, queries) without saga support
 * @param options - Optional workflow-level configuration
 *
 * @example
 * ```typescript
 * const orderWorkflow = createContainerRestateWorkflow(
 *   container,
 *   "OrderWorkflow",
 *   async (saga, ctx, input) => {
 *     const order = await createOrder(saga, input);
 *     // Can use ctx.workflowId(), durable promises, etc.
 *     return { orderId: order.orderId };
 *   },
 *   {
 *     getStatus: async (ctx) => ctx.promise<string>("status"),
 *   }
 * );
 * ```
 */
export function createContainerRestateWorkflow<
  TCradle extends object,
  Name extends string,
  Input,
  Output,
  Handlers extends Record<
    string,
    (ctx: restate.WorkflowSharedContext, input: any) => Promise<any>
  > = Record<string, never>,
>(
  container: AwilixContainer<TCradle>,
  name: Name,
  run: (
    saga: ContainerWorkflowContext<TCradle>,
    ctx: restate.WorkflowContext,
    input: Input
  ) => Promise<Output>,
  handlers?: Handlers,
  options?: SagaRestateWorkflowOptions
): ContainerRestateWorkflowService<Name, Input, Output, TCradle> {
  const workflowOptions = options
    ? {
        retryPolicy: toServiceRetryPolicy(options.retryPolicy),
        idempotencyRetention: options.idempotencyRetention,
        journalRetention: options.journalRetention,
        inactivityTimeout: options.inactivityTimeout,
        abortTimeout: options.abortTimeout,
        ingressPrivate: options.ingressPrivate,
        asTerminalError: options.asTerminalError,
      }
    : undefined;

  const workflow = restate.workflow({
    name,
    handlers: {
      run: async (ctx: restate.WorkflowContext, input: Input) => {
        const services = container.cradle;

        const saga: ContainerWorkflowContext<TCradle, typeof container> = {
          ctx,
          compensations: [],
          services,
          container,
        };

        try {
          return await run(saga, ctx, input);
        } catch (e) {
          if (e instanceof restate.TerminalError) {
            for (const compensate of saga.compensations.reverse()) {
              await compensate();
            }
          }
          throw e;
        }
      },
      ...handlers,
    },
    options: workflowOptions,
  });

  return Object.assign(workflow, {
    runAsStep: (parentSaga: ContainerWorkflowContext<TCradle>, input: Input): Promise<Output> => {
      return run(parentSaga, parentSaga.ctx, input);
    },
  }) as ContainerRestateWorkflowService<Name, Input, Output, TCradle>;
}

/**
 * Creates a workflow factory bound to a container.
 *
 * Use this when you want to define the workflow once and create instances
 * with different containers (e.g., per-request in Directus).
 *
 * @example
 * ```typescript
 * // Define workflow factory once
 * const createOrderWorkflow = defineContainerWorkflow<AppServices>()(
 *   "OrderWorkflow",
 *   async (saga, input) => {
 *     const order = await createOrder(saga, input);
 *     return order;
 *   }
 * );
 *
 * // In Directus endpoint - create with request-specific container
 * router.post("/orders", async (req, res) => {
 *   const container = createRequestContainer(directusContext, req);
 *   const workflow = createOrderWorkflow(container);
 *   // Use workflow...
 * });
 * ```
 */
export function defineContainerWorkflow<TCradle extends object>() {
  return function <Name extends string, Input, Output>(
    name: Name,
    handler: (saga: ContainerSagaContext<TCradle>, input: Input) => Promise<Output>,
    options?: SagaWorkflowOptions
  ) {
    return (
      container: AwilixContainer<TCradle>
    ): ContainerWorkflowService<Name, Input, Output, TCradle> => {
      return createContainerWorkflow(container, name, handler, options);
    };
  };
}

/**
 * Creates a Restate Workflow factory bound to a container.
 *
 * Use this when you want to define the workflow once and create instances
 * with different containers (e.g., per-request in Directus).
 *
 * Similar to `defineContainerWorkflow` but for long-running Restate Workflows
 * with workflowId-based deduplication and optional signal/query handlers.
 *
 * @example
 * ```typescript
 * // Define workflow factory once
 * const createOrderWorkflow = defineContainerRestateWorkflow<AppServices>()(
 *   "OrderWorkflow",
 *   async (saga, ctx, input) => {
 *     const order = await createOrder(saga, input);
 *     // Can use ctx.workflowId(), durable promises, etc.
 *     return { orderId: order.orderId };
 *   },
 *   {
 *     getStatus: async (ctx) => ctx.promise<string>("status"),
 *   }
 * );
 *
 * // In Directus endpoint - create with request-specific container
 * router.post("/orders", async (req, res) => {
 *   const container = createRequestContainer(directusContext, req);
 *   const workflow = createOrderWorkflow(container);
 *   // Use workflow...
 * });
 * ```
 */
export function defineContainerRestateWorkflow<TCradle extends object>() {
  return function <
    Name extends string,
    Input,
    Output,
    Handlers extends Record<
      string,
      (ctx: restate.WorkflowSharedContext, input: any) => Promise<any>
    > = Record<string, never>,
  >(
    name: Name,
    run: (
      saga: ContainerWorkflowContext<TCradle>,
      ctx: restate.WorkflowContext,
      input: Input
    ) => Promise<Output>,
    handlers?: Handlers,
    options?: SagaRestateWorkflowOptions
  ) {
    return (
      container: AwilixContainer<TCradle>
    ): ContainerRestateWorkflowService<Name, Input, Output, TCradle> => {
      return createContainerRestateWorkflow(container, name, run, handlers, options);
    };
  };
}

/**
 * Re-export StepResponse for convenience when using container steps.
 */
export { StepResponse } from "./steps.js";
