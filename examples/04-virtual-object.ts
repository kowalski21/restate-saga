/**
 * Virtual Object with Saga Support
 *
 * Demonstrates:
 * - Stateful entities (Virtual Objects)
 * - Exclusive handlers with saga support
 * - Shared handlers for read-only operations
 * - Multi-step transactions on state
 */

import * as restate from "@restatedev/restate-sdk";
import {
  createSagaVirtualObject,
  createSagaStep,
  StepResponse,
} from "restate-saga";

// Define steps for wallet operations

const creditAccount = createSagaStep<
  { ctx: restate.ObjectContext; amount: number; description: string },
  { newBalance: number; transactionId: string },
  { transactionId: string; amount: number }
>({
  name: "CreditAccount",
  run: async ({ input }) => {
    const balance = (await input.ctx.get<number>("balance")) || 0;
    const newBalance = balance + input.amount;
    const transactionId = `txn_${Date.now()}`;

    input.ctx.set("balance", newBalance);

    // Store transaction in history
    const history = (await input.ctx.get<string[]>("history")) || [];
    history.push(`${transactionId}: +${input.amount} (${input.description})`);
    input.ctx.set("history", history);

    return new StepResponse(
      { newBalance, transactionId },
      { transactionId, amount: input.amount }
    );
  },
  compensate: async (data) => {
    console.log(
      `Compensating credit: reversing ${data.amount} for txn ${data.transactionId}`
    );
    // Note: In a real app, you'd need the ctx to update state
    // This compensation is tracked for the saga but state reversal
    // would need to be handled by a subsequent debit
  },
});

const debitAccount = createSagaStep<
  { ctx: restate.ObjectContext; amount: number; description: string },
  { newBalance: number; transactionId: string },
  { transactionId: string; amount: number }
>({
  name: "DebitAccount",
  run: async ({ input }) => {
    const balance = (await input.ctx.get<number>("balance")) || 0;

    if (balance < input.amount) {
      return StepResponse.permanentFailure("Insufficient funds", {
        transactionId: "",
        amount: input.amount,
      });
    }

    const newBalance = balance - input.amount;
    const transactionId = `txn_${Date.now()}`;

    input.ctx.set("balance", newBalance);

    const history = (await input.ctx.get<string[]>("history")) || [];
    history.push(`${transactionId}: -${input.amount} (${input.description})`);
    input.ctx.set("history", history);

    return new StepResponse(
      { newBalance, transactionId },
      { transactionId, amount: input.amount }
    );
  },
  compensate: async (data) => {
    if (data.transactionId) {
      console.log(
        `Compensating debit: reversing ${data.amount} for txn ${data.transactionId}`
      );
    }
  },
});

// Create the Wallet Virtual Object
export const wallet = createSagaVirtualObject(
  "Wallet",
  {
    // Exclusive handlers with saga support

    initialize: async (saga, ctx, input: { initialBalance: number }) => {
      const existing = await ctx.get<number>("balance");
      if (existing !== null) {
        return { success: false, message: "Wallet already initialized" };
      }
      ctx.set("balance", input.initialBalance);
      ctx.set("history", [`Initial deposit: ${input.initialBalance}`]);
      return { success: true, balance: input.initialBalance };
    },

    deposit: async (saga, ctx, input: { amount: number; description?: string }) => {
      const result = await creditAccount(saga, {
        ctx,
        amount: input.amount,
        description: input.description || "Deposit",
      });
      return {
        success: true,
        newBalance: result.newBalance,
        transactionId: result.transactionId,
      };
    },

    withdraw: async (saga, ctx, input: { amount: number; description?: string }) => {
      const result = await debitAccount(saga, {
        ctx,
        amount: input.amount,
        description: input.description || "Withdrawal",
      });
      return {
        success: true,
        newBalance: result.newBalance,
        transactionId: result.transactionId,
      };
    },

    transfer: async (
      saga,
      ctx,
      input: { toWalletId: string; amount: number; description?: string }
    ) => {
      // Step 1: Debit from this wallet
      const debit = await debitAccount(saga, {
        ctx,
        amount: input.amount,
        description: `Transfer to ${input.toWalletId}`,
      });

      // Step 2: Credit to destination wallet
      // In production, this would call the other wallet's deposit method
      // For this example, we just log it
      console.log(`Would credit ${input.amount} to wallet ${input.toWalletId}`);

      return {
        success: true,
        fromBalance: debit.newBalance,
        transactionId: debit.transactionId,
      };
    },

    // Multi-step operation: exchange currency
    exchange: async (
      saga,
      ctx,
      input: { fromAmount: number; toAmount: number; rate: number }
    ) => {
      // Debit original currency
      const debit = await debitAccount(saga, {
        ctx,
        amount: input.fromAmount,
        description: `Exchange (sell at rate ${input.rate})`,
      });

      // Credit converted amount
      // If this fails, the debit is automatically rolled back
      const credit = await creditAccount(saga, {
        ctx,
        amount: input.toAmount,
        description: `Exchange (buy at rate ${input.rate})`,
      });

      return {
        success: true,
        newBalance: credit.newBalance,
        exchanged: {
          from: input.fromAmount,
          to: input.toAmount,
          rate: input.rate,
        },
      };
    },
  },
  {
    // Shared handlers (read-only, concurrent access)

    getBalance: async (ctx) => {
      const balance = (await ctx.get<number>("balance")) || 0;
      return { balance };
    },

    getHistory: async (ctx) => {
      const history = (await ctx.get<string[]>("history")) || [];
      return { history };
    },

    getInfo: async (ctx) => {
      const balance = (await ctx.get<number>("balance")) || 0;
      const history = (await ctx.get<string[]>("history")) || [];
      return {
        balance,
        transactionCount: history.length,
        lastTransaction: history[history.length - 1] || null,
      };
    },
  }
);

restate.endpoint().bind(wallet).listen(9080);
