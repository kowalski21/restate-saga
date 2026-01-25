// @ts-nocheck - SagaVirtualObject type is incompatible with SDK client types
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { RestateTestEnvironment } from "@restatedev/restate-sdk-testcontainers";
import * as clients from "@restatedev/restate-sdk-clients";
import * as restate from "@restatedev/restate-sdk";
import {
  createSagaVirtualObject,
  createSagaStep,
  StepResponse,
} from "../../src/index.js";

// Track operations for verification
const operationLog: string[] = [];

// Steps for the virtual object
const creditStep = createSagaStep<
  { ctx: restate.ObjectContext; amount: number },
  { newBalance: number },
  { amount: number; previousBalance: number }
>({
  name: "Credit",
  run: async ({ input }) => {
    const balance = (await input.ctx.get<number>("balance")) || 0;
    const newBalance = balance + input.amount;
    input.ctx.set("balance", newBalance);
    operationLog.push(`credit:${input.amount}`);
    return new StepResponse(
      { newBalance },
      { amount: input.amount, previousBalance: balance }
    );
  },
  compensate: async (data) => {
    operationLog.push(`compensate:credit:${data.amount}`);
  },
});

const debitStep = createSagaStep<
  { ctx: restate.ObjectContext; amount: number },
  { newBalance: number },
  { amount: number }
>({
  name: "Debit",
  run: async ({ input }) => {
    const balance = (await input.ctx.get<number>("balance")) || 0;
    if (balance < input.amount) {
      return StepResponse.permanentFailure("Insufficient balance", {
        amount: input.amount,
      });
    }
    const newBalance = balance - input.amount;
    input.ctx.set("balance", newBalance);
    operationLog.push(`debit:${input.amount}`);
    return new StepResponse({ newBalance }, { amount: input.amount });
  },
  compensate: async (data) => {
    operationLog.push(`compensate:debit:${data.amount}`);
  },
});

// Virtual Object definition
const accountObject = createSagaVirtualObject(
  "Account",
  {
    // Exclusive handlers with saga support
    initialize: async (saga, ctx, input: { initialBalance: number }) => {
      const existing = await ctx.get<number>("balance");
      if (existing !== null) {
        return { success: false, message: "Already initialized" };
      }
      ctx.set("balance", input.initialBalance);
      return { success: true, balance: input.initialBalance };
    },

    deposit: async (saga, ctx, input: { amount: number }) => {
      const result = await creditStep(saga, { ctx, amount: input.amount });
      return { success: true, newBalance: result.newBalance };
    },

    withdraw: async (saga, ctx, input: { amount: number }) => {
      const result = await debitStep(saga, { ctx, amount: input.amount });
      return { success: true, newBalance: result.newBalance };
    },

    transfer: async (
      saga,
      ctx,
      input: { toAccountId: string; amount: number }
    ) => {
      // Debit from this account
      const debit = await debitStep(saga, { ctx, amount: input.amount });

      // Credit to destination account (simulated - would be a service call in real code)
      // For testing, we'll just verify the debit worked
      operationLog.push(`transfer:${input.amount}:to:${input.toAccountId}`);

      return {
        success: true,
        newBalance: debit.newBalance,
        transferId: `txn_${Date.now()}`,
      };
    },
  },
  {
    // Shared handlers (read-only, concurrent access)
    getBalance: async (ctx) => {
      const balance = (await ctx.get<number>("balance")) || 0;
      return { balance };
    },
  }
);

describe("Saga Virtual Object Integration", () => {
  let restateTestEnvironment: RestateTestEnvironment;
  let restateIngress: clients.Ingress;

  beforeAll(async () => {
    restateTestEnvironment = await RestateTestEnvironment.start({
      services: [accountObject],
    });
    restateIngress = clients.connect({
      url: restateTestEnvironment.baseUrl(),
    });
  }, 30000);

  afterAll(async () => {
    await restateTestEnvironment?.stop();
  });

  describe("Initialization", () => {
    it("should initialize account with balance", async () => {
      const account = restateIngress.objectClient(accountObject, "init-test-1");

      const result = await account.initialize({ initialBalance: 100 });

      expect(result.success).toBe(true);
      expect(result.balance).toBe(100);
    });

    it("should reject re-initialization", async () => {
      const account = restateIngress.objectClient(accountObject, "init-test-2");

      await account.initialize({ initialBalance: 50 });
      const result = await account.initialize({ initialBalance: 100 });

      expect(result.success).toBe(false);
      expect(result.message).toBe("Already initialized");
    });
  });

  describe("Deposit", () => {
    it("should deposit and update balance", async () => {
      operationLog.length = 0;
      const account = restateIngress.objectClient(accountObject, "deposit-test");

      await account.initialize({ initialBalance: 100 });
      const result = await account.deposit({ amount: 50 });

      expect(result.success).toBe(true);
      expect(result.newBalance).toBe(150);
      expect(operationLog).toContain("credit:50");
    });
  });

  describe("Withdraw", () => {
    it("should withdraw when sufficient balance", async () => {
      operationLog.length = 0;
      const account = restateIngress.objectClient(accountObject, "withdraw-test-1");

      await account.initialize({ initialBalance: 100 });
      const result = await account.withdraw({ amount: 30 });

      expect(result.success).toBe(true);
      expect(result.newBalance).toBe(70);
      expect(operationLog).toContain("debit:30");
    });

    it("should reject withdrawal with insufficient balance", async () => {
      const account = restateIngress.objectClient(accountObject, "withdraw-test-2");

      await account.initialize({ initialBalance: 50 });

      await expect(account.withdraw({ amount: 100 })).rejects.toThrow(
        "Insufficient balance"
      );
    });
  });

  describe("Shared handlers", () => {
    it("should read balance via shared handler", async () => {
      const account = restateIngress.objectClient(accountObject, "balance-test");

      await account.initialize({ initialBalance: 200 });
      await account.deposit({ amount: 50 });

      const result = await account.getBalance();

      expect(result.balance).toBe(250);
    });
  });

  describe("State verification", () => {
    it("should persist state correctly", async () => {
      const accountId = "state-test";
      const account = restateIngress.objectClient(accountObject, accountId);

      await account.initialize({ initialBalance: 100 });
      await account.deposit({ amount: 25 });
      await account.withdraw({ amount: 10 });

      // Verify state using test environment
      const state = restateTestEnvironment.stateOf(accountObject, accountId);
      const balance = await state.get("balance");

      expect(balance).toBe(115); // 100 + 25 - 10
    });
  });
});
