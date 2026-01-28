# Dependency Injection Plan for Saga Workflows

## Overview

This document describes the dependency injection pattern for saga workflows using Awilix containers. The core idea: **workflows receive a container at creation time and extend the saga context with resolved services**.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Awilix Container                         │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  cradle: { ordersService, inventoryService, db }    │   │
│  │  resolve(key): service instance                     │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│            createContainerWorkflow(container, ...)          │
│                  (container captured in closure)            │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼ (on each invocation)
┌─────────────────────────────────────────────────────────────┐
│                  Workflow Handler Execution                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  const services = container.cradle;                 │   │
│  │  const saga = { ctx, compensations: [],             │   │
│  │                 services, container };              │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    ContainerSagaContext                     │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  ctx: restate.Context                               │   │
│  │  compensations: CompensationFn[]                    │   │
│  │  services: TCradle      ← cradle (direct access)    │   │
│  │  container: TContainer  ← full container (.resolve) │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                      Saga Steps                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  saga.services.database      ← direct property      │   │
│  │  saga.container.resolve(key) ← dynamic resolution   │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Implementation Steps

### 1. Define Services Type (TCradle)

```typescript
interface AppServices {
  ordersService: ItemsService;
  inventoryService: ItemsService;
  database: Knex;
}
```

### 2. Create and Configure Container

```typescript
import { createContainer, asValue, asClass } from "awilix";

const container = createContainer<AppServices>();
container.register({
  ordersService: asValue(new ItemsService("orders", context)),
  inventoryService: asValue(new ItemsService("inventory", context)),
  database: asValue(knex),
});
```

### 3. Create Container-Aware Steps

```typescript
const createOrder = createContainerStep<AppServices>()({
  name: "CreateOrder",
  run: async (saga, input: { userId: string; items: any[] }) => {
    // Option 1: Direct property access via saga.services (recommended)
    const orderId = await saga.services.ordersService.createOne({
      user: input.userId,
      items: input.items,
    });

    // Option 2: Dynamic resolution via saga.container
    const db = saga.container.resolve("database");

    return new StepResponse({ orderId }, { orderId });
  },
  compensate: async (saga, data) => {
    // Both saga.services and saga.container available in compensation
    if ("orderId" in data) {
      await saga.services.ordersService.deleteOne(data.orderId);
    }
  },
});
```

### 4. Create Container Workflow

```typescript
const orderWorkflow = createContainerWorkflow(
  container,
  "OrderWorkflow",
  async (saga, input: { userId: string; items: any[] }) => {
    const order = await createOrder(saga, input);
    const inventory = await reserveInventory(saga, {
      orderId: order.orderId,
      items: input.items,
    });
    return { order, inventory };
  }
);
```

### 5. Register with Restate

```typescript
restate.endpoint().bind(orderWorkflow).listen();
```

## Workflow Structure and Invocation

### Return Type Structure

When you create a workflow with `createContainerWorkflow`, the return type is:

```typescript
{
  name: "OrderWorkflow",
  handlers: {
    run: (ctx: restate.Context, input: Input) => Promise<Output>
  },
  runAsStep: (parentSaga: AnyContainerSagaContext<TCradle>, input: Input) => Promise<Output>
}
```

Note: Handlers are nested under `handlers`, not at the top level. This matches Restate's service structure.

### Correct Invocation Methods

**Via Restate Client (recommended for external calls):**

```typescript
import * as restate from "@restatedev/restate-sdk-clients";

const client = restate.connect({ url: "http://restate:8080" });
const result = await client.serviceClient(orderWorkflow).run(input);
```

**Via Restate Context (for service-to-service calls):**

```typescript
// Inside another Restate handler
const result = await ctx.serviceClient(orderWorkflow).run(input);
```

**Do NOT call `workflow.handlers.run()` directly** - it requires a `restate.Context` which you don't have outside of Restate, and bypasses durable execution.

## Nested Workflows with runAsStep

### How runAsStep Works

The `runAsStep` method allows running a workflow as a step within a parent saga. **Critically, it uses the parent's saga context, not its own container.**

```typescript
// Implementation inside createContainerWorkflow
runAsStep: (parentSaga: AnyContainerSagaContext<TCradle>, input: Input): Promise<Output> => {
  return handler(parentSaga as ContainerSagaContext<TCradle>, input);
  //             ↑ parent's saga context passed directly
};
```

### What Gets Inherited

When using `runAsStep`, the nested workflow inherits from the parent:

| Property | Inherited? | Notes |
|----------|------------|-------|
| `saga.ctx` | Yes | Same Restate context |
| `saga.compensations` | Yes | Compensations join parent's stack |
| `saga.services` | Yes | Same services from parent's container |
| `saga.container` | Yes | Same container from parent |

**The container used to create the nested workflow is irrelevant when using `runAsStep`.**

### Example: Nested Workflow

```typescript
// Define payment workflow
const paymentWorkflow = createContainerWorkflow(
  container,  // ← This container is used when invoked via Restate
  "PaymentWorkflow",
  async (saga, input: { amount: number }) => {
    return await processPayment(saga, input);
  }
);

// Define order workflow that nests payment
const orderWorkflow = createContainerWorkflow(
  container,
  "OrderWorkflow",
  async (saga, input) => {
    const order = await createOrder(saga, input);

    // Nested workflow uses PARENT's saga context
    // paymentWorkflow's container is ignored here
    const payment = await paymentWorkflow.runAsStep(saga, {
      amount: order.total
    });

    return { order, payment };
  }
);
```

### Nested Workflow Flow

```
orderWorkflow invoked via Restate
        │
        ▼
container.cradle resolved → services
        │
        ▼
saga = { ctx, compensations: [], services, container }
        │
        ▼
createOrder(saga, input)  ← uses saga.services or saga.container
        │
        ▼
paymentWorkflow.runAsStep(saga, input)
        │
        ▼
paymentWorkflow handler receives SAME saga
        │   - saga.ctx (same)
        │   - saga.compensations (same array - compensations added here join parent's stack)
        │   - saga.services (same - from parent's container)
        │   - saga.container (same - parent's container)
        │
        ▼
processPayment(saga, input)  ← uses same saga.services/container
```

## Key Types

| Type | Description |
|------|-------------|
| `ContainerSagaContext<TCradle, TContainer?>` | SagaContext with `services: TCradle` and `container: TContainer` |
| `ContainerWorkflowContext<TCradle, TContainer?>` | SagaWorkflowContext with `services` and `container` |
| `ContainerStepConfig<TCradle, Input, Output, CompensationData>` | Step configuration with typed services |
| `ContainerWorkflowService<Name, Input, Output, TCradle>` | Return type of createContainerWorkflow |

### Saga Context Properties

| Property | Type | Description |
|----------|------|-------------|
| `saga.ctx` | `restate.Context` | The Restate context |
| `saga.compensations` | `Array<() => Promise<void>>` | Compensation stack |
| `saga.services` | `TCradle` | Cradle proxy for direct property access |
| `saga.container` | `TContainer` | Full container for `.resolve()` calls |

## Key Functions

| Function | Purpose |
|----------|---------|
| `createContainerStep<TCradle>()` | Create a step with DI support |
| `createContainerStepStrict<TCradle>()` | Create a strict step (compensation only on success) |
| `createContainerWorkflow()` | Create a workflow that injects container |
| `createContainerRestateWorkflow()` | Create a Restate Workflow with DI |
| `defineContainerWorkflow<TCradle>()` | Factory pattern for per-request containers |
| `defineContainerRestateWorkflow<TCradle>()` | Factory pattern for per-request Restate Workflows |

## Accessing Services

Two ways to access dependencies in steps:

### 1. Direct Property Access (Recommended)

```typescript
// saga.services is the cradle - direct property access
const db = saga.services.database;
const orders = saga.services.ordersService;
```

Best for: Static, known dependencies with full type safety.

### 2. Container Resolution

```typescript
// saga.container has .resolve() method
const db = saga.container.resolve("database");
const dynamic = saga.container.resolve<MyType>("dynamic_key");
```

Best for: Dynamic keys, MedusaContainer's typed `.resolve()`, or advanced patterns.

### Using with MedusaContainer

If using a custom container like MedusaContainer with typed `.resolve()`:

```typescript
import type { MedusaContainer, ModuleImplementations } from "./container";

const step = createContainerStep<ModuleImplementations>()({
  name: "MyStep",
  run: async (saga, input) => {
    // Direct access (saga.services is the cradle)
    const db = saga.services.database;

    // Or use container's typed resolve
    const container = saga.container as MedusaContainer<ModuleImplementations>;
    const db2 = container.resolve("database"); // Typed!

    return new StepResponse({ result }, null);
  },
});
```

## Workflow Execution Flow

1. **Workflow invoked** with input
2. **Container cradle resolved** → `services = container.cradle`
3. **Extended saga context created** → `{ ctx, compensations: [], services, container }`
4. **Handler executes** with saga context
5. **Each step receives** the same saga context with services and container
6. **On TerminalError** → compensations run in reverse order (services still available)

## Factory Pattern (Per-Request Containers)

For frameworks like Directus where containers are created per-request.

### Why Use Factory Pattern?

In Directus, services need per-request context:
- **Accountability** - who is making the request (user, role, permissions)
- **Schema** - the current database schema

These values differ for every request, so you cannot create a single container at startup.

### Usage

**Step 1: Define workflow logic once (without a container)**

```typescript
const createOrderWorkflow = defineContainerWorkflow<AppServices>()(
  "OrderWorkflow",
  async (saga, input) => {
    const order = await createOrder(saga, input);
    return order;
  }
);
```

This returns a **factory function**, not a workflow.

**Step 2: Create per-request container and bind**

```typescript
router.post("/orders", async (req, res) => {
  // Create container with request-specific context
  const { accountability, schema } = req;
  const container = createContainer<AppServices>();
  container.register({
    ordersService: asValue(new ItemsService("orders", { schema, accountability, knex })),
    inventoryService: asValue(new ItemsService("inventory", { schema, accountability, knex })),
  });

  // Create workflow instance with this container
  const workflow = createOrderWorkflow(container);

  // Register and invoke via Restate
  restate.endpoint().bind(workflow).listen();

  // Or invoke via Restate client
  const client = restate.connect({ url: "http://restate:8080" });
  const result = await client.serviceClient(workflow).run(input);
});
```

### Factory Pattern with Nested Workflows

For nested workflows with the factory pattern, **both workflows should be created with the same container**:

```typescript
// Define factories
const createPaymentWorkflow = defineContainerWorkflow<AppServices>()(
  "PaymentWorkflow",
  async (saga, input) => processPayment(saga, input)
);

const createOrderWorkflow = defineContainerWorkflow<AppServices>()(
  "OrderWorkflow",
  async (saga, input) => {
    const order = await createOrder(saga, input);
    // Note: paymentWorkflow must be in scope here
    const payment = await paymentWorkflow.runAsStep(saga, { amount: order.total });
    return { order, payment };
  }
);

// At request time
router.post("/orders", async (req, res) => {
  const container = createRequestContainer(req);

  // Create both with same container
  const paymentWorkflow = createPaymentWorkflow(container);
  const orderWorkflow = createOrderWorkflow(container);

  // Register both
  restate.endpoint()
    .bind(orderWorkflow)
    .bind(paymentWorkflow)
    .listen();
});
```

**Important:** Since `runAsStep` uses the parent's saga context (not the nested workflow's container), the container used to create the nested workflow only matters when that workflow is invoked directly via Restate - not when used as a nested step.

## Benefits

- **Single resolution**: Container cradle resolved once per workflow invocation
- **Consistent access**: All steps and compensations share the same services instance
- **Dual access patterns**: Use `saga.services` for direct access or `saga.container.resolve()` for dynamic keys
- **Type safety**: Full TypeScript support with TCradle generic
- **MedusaContainer compatible**: Works with custom containers that extend AwilixContainer
- **Testability**: Easy to mock services by providing a test container
- **Framework agnostic**: Works with any Awilix container setup
- **Nested workflow support**: Child workflows inherit parent's services and compensation stack
