import { describe, it, expect, jest } from "@jest/globals";
import crypto from "crypto";
import { verifySettlementProof } from "../lib/settlement_verifier.js";

describe("Settlement Verifier (Base USDC, Lightning, Simulation Controls)", () => {
  const sampleQuote = {
    quoteId: "quo_sample_123",
    total: 25.50,
    currency: "USD"
  };

  describe("Simulated Proofs (Sandbox vs Production)", () => {
    it("allows valid simulated proof in non-production environments", async () => {
      const proof = {
        status: "PAID",
        amount: 25.50,
        paymentId: "pay_sim_123"
      };

      const result = await verifySettlementProof(proof, sampleQuote, { allowSimulation: true });
      expect(result.valid).toBe(true);
      expect(result.paymentId).toBe("pay_sim_123");
      expect(result.rail).toBe("simulated_x402");
    });

    it("rejects simulated proof when allowSimulation is false (production mode)", async () => {
      const proof = {
        status: "PAID",
        amount: 25.50,
        paymentId: "pay_sim_fake"
      };

      await expect(
        verifySettlementProof(proof, sampleQuote, { allowSimulation: false })
      ).rejects.toThrow("Simulated payment proofs are forbidden in production environment");
    });
  });

  describe("Lightning Network Settlement", () => {
    it("successfully verifies valid Lightning preimage", async () => {
      const preimage = "11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff";
      const paymentHash = crypto.createHash("sha256").update(Buffer.from(preimage, "hex")).digest("hex");

      const proof = {
        rail: "lightning",
        preimage,
        payment_hash: paymentHash,
        amount: 25.50
      };

      const result = await verifySettlementProof(proof, sampleQuote, { allowSimulation: false });
      expect(result.valid).toBe(true);
      expect(result.rail).toBe("lightning");
      expect(result.paymentId).toBe(paymentHash);
    });

    it("rejects invalid Lightning preimage that does not match payment_hash", async () => {
      const wrongPreimage = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
      const paymentHash = crypto.createHash("sha256").update(Buffer.from("0000", "hex")).digest("hex");

      const proof = {
        rail: "lightning",
        preimage: wrongPreimage,
        payment_hash: paymentHash,
        amount: 25.50
      };

      await expect(
        verifySettlementProof(proof, sampleQuote, { allowSimulation: false })
      ).rejects.toThrow("Lightning preimage does not match payment hash");
    });
  });

  describe("Base Network Settlement (EVM / USDC)", () => {
    const validTxHash = "0x" + "a".repeat(64);

    it("verifies confirmed Base transaction receipt via JSON-RPC", async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        json: async () => ({
          result: {
            status: "0x1",
            logs: [
              {
                topics: [
                  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
                  "0x0000000000000000000000001111111111111111111111111111111111111111",
                  "0x0000000000000000000000003233e3f7bfeb1ea9b0a5d4d3f8dc90209420072f"
                ]
              }
            ]
          }
        })
      });

      const proof = {
        rail: "base_usdc",
        tx_hash: validTxHash,
        amount: 25.50
      };

      const result = await verifySettlementProof(proof, sampleQuote, {
        allowSimulation: false,
        rpcUrl: "https://mock.base.rpc",
        merchantWallet: "0x3233E3f7bFEb1eA9B0a5d4d3F8dC90209420072F",
        fetchFn: mockFetch
      });

      expect(result.valid).toBe(true);
      expect(result.rail).toBe("base_usdc");
      expect(result.tx_hash).toBe(validTxHash);
    });

    it("rejects reverted Base transaction (status 0x0)", async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        json: async () => ({
          result: {
            status: "0x0"
          }
        })
      });

      const proof = {
        rail: "base_usdc",
        tx_hash: validTxHash,
        amount: 25.50
      };

      await expect(
        verifySettlementProof(proof, sampleQuote, {
          allowSimulation: false,
          rpcUrl: "https://mock.base.rpc",
          fetchFn: mockFetch
        })
      ).rejects.toThrow("Base transaction failed on-chain");
    });

    it("rejects invalid Base transaction hash formatting in production", async () => {
      const proof = {
        rail: "base_usdc",
        tx_hash: "0xinvalid_short_hash",
        amount: 25.50
      };

      await expect(
        verifySettlementProof(proof, sampleQuote, { allowSimulation: false })
      ).rejects.toThrow("Invalid Base transaction hash format");
    });
  });

  describe("Amount Protection", () => {
    it("rejects settlement proof with mismatched amount", async () => {
      const proof = {
        status: "PAID",
        amount: 1.00 // quote is 25.50
      };

      await expect(
        verifySettlementProof(proof, sampleQuote, { allowSimulation: true })
      ).rejects.toThrow("Settlement amount mismatch");
    });
  });
});
