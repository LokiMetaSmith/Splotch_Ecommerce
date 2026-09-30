import crypto from "crypto";

/**
 * Returns true if Base USDC settlement is enabled.
 * In production, requires an explicitly configured, non-placeholder BASE_MERCHANT_WALLET.
 */
export function isBaseUsdcEnabled() {
  const wallet = process.env.BASE_MERCHANT_WALLET;
  const PLACEHOLDER = "0x3233E3f7bFEb1eA9B0a5d4d3F8dC90209420072F".toLowerCase();
  if (process.env.NODE_ENV === "production") {
    return Boolean(wallet && wallet.toLowerCase() !== PLACEHOLDER && !wallet.startsWith("${"));
  }
  return true;
}

/**
 * Returns true if Lightning settlement is enabled.
 * In production, requires X402_API_KEY or SQUARE_ACCESS_TOKEN configured.
 */
export function isLightningEnabled() {
  if (process.env.NODE_ENV === "production") {
    let key = process.env.X402_API_KEY;
    if (!key || key.startsWith("${")) {
      key = process.env.SQUARE_ACCESS_TOKEN;
    }
    return Boolean(key && !key.startsWith("${"));
  }
  return true;
}

/**
 * Returns list of currently active settlement rails based on configuration.
 */
export function getActiveSettlementMethods() {
  const methods = [];
  if (isLightningEnabled()) methods.push("lightning");
  if (isBaseUsdcEnabled()) methods.push("base_usdc");
  return methods;
}

/**
 * Validates payment and settlement proofs for autonomous agent purchases.
 * Supports:
 *  1. Base USDC on-chain settlement (via JSON-RPC eth_getTransactionReceipt)
 *  2. Lightning network preimage verification
 *  3. Simulated x402 payment tokens (strictly rejected when NODE_ENV === 'production')
 *
 * @param {string|object} proofInput - Base64 encoded JSON string or settlement object
 * @param {object} quoteDetails - The stored quote record containing total amount
 * @param {object} options - Configuration overrides (rpcUrl, merchantWallet, allowSimulation, fetchFn)
 * @returns {Promise<object>} Verification result with payment metadata
 */
export async function verifySettlementProof(proofInput, quoteDetails, options = {}) {
  let proof = proofInput;

  if (typeof proofInput === "string") {
    try {
      const decoded = Buffer.from(proofInput, "base64").toString("utf-8");
      proof = JSON.parse(decoded);
    } catch (err) {
      throw new Error(`Invalid payment proof format: unable to parse base64 JSON (${err.message})`);
    }
  }

  if (!proof || typeof proof !== "object") {
    throw new Error("Invalid payment proof: missing proof payload");
  }

  const rail = (proof.rail || "x402").toLowerCase();
  const allowSim = options.allowSimulation ?? (process.env.NODE_ENV !== "production");
  const expectedAmount = quoteDetails?.total !== undefined ? parseFloat(quoteDetails.total) : null;

  // 1. Amount Verification (if specified in proof)
  const proofAmount = proof.amount !== undefined ? parseFloat(proof.amount) : null;
  if (expectedAmount !== null && proofAmount !== null) {
    if (Math.abs(proofAmount - expectedAmount) >= 0.01) {
      throw new Error(`Settlement amount mismatch: expected $${expectedAmount.toFixed(2)}, received $${proofAmount.toFixed(2)}`);
    }
  }

  // 2. Rail-Specific Settlement Verification
  // --- Lightning Network ---
  if (rail === "lightning") {
    const preimage = proof.preimage || proof.payment_preimage;
    const paymentHash = proof.payment_hash || proof.paymentHash || proof.paymentId;

    if (!paymentHash) {
      throw new Error("Lightning settlement requires payment_hash");
    }

    if (preimage) {
      const computedHash = crypto.createHash("sha256").update(Buffer.from(preimage, "hex")).digest("hex");
      if (computedHash.toLowerCase() !== paymentHash.toLowerCase()) {
        throw new Error("Lightning preimage does not match payment hash");
      }
    } else if (!allowSim) {
      throw new Error("Lightning settlement requires verified preimage in production");
    }

    return {
      valid: true,
      rail: "lightning",
      paymentId: paymentHash,
      payment_hash: paymentHash,
      amount: expectedAmount ?? proofAmount,
      payer: proof.payer || "lightning-node",
      verifiedAt: new Date().toISOString()
    };
  }

  // --- Base Network (EVM / USDC) ---
  const isBase = rail === "base" || rail === "base_usdc" || (rail === "x402" && (proof.network || "").toLowerCase() === "base") || proof.tx_hash;
  if (isBase && proof.tx_hash) {
    const txHash = proof.tx_hash;
    const isValidTxHash = /^0x([A-Fa-f0-9]{64})$/.test(txHash);

    if (!isValidTxHash) {
      if (!allowSim) {
        throw new Error("Invalid Base transaction hash format (must be 0x followed by 64 hex characters)");
      }
    }

    const rpcUrl = options.rpcUrl || process.env.BASE_RPC_URL || "https://mainnet.base.org";
    const PLACEHOLDER_WALLET = "0x3233E3f7bFEb1eA9B0a5d4d3F8dC90209420072F".toLowerCase();
    let merchantWallet = options.merchantWallet || process.env.BASE_MERCHANT_WALLET;

    if (!merchantWallet || merchantWallet.toLowerCase() === PLACEHOLDER_WALLET) {
      if (!allowSim) {
        throw new Error("Base USDC settlement is disabled in production: BASE_MERCHANT_WALLET must be explicitly configured in environment variables and cannot use default placeholder.");
      }
      merchantWallet = PLACEHOLDER_WALLET;
    } else {
      merchantWallet = merchantWallet.toLowerCase();
    }
    const fetchFn = options.fetchFn || globalThis.fetch;

    if (rpcUrl && typeof fetchFn === "function") {
      try {
        const response = await fetchFn(rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            method: "eth_getTransactionReceipt",
            params: [txHash],
            id: 1
          })
        });

        const rpcResult = await response.json();
        const receipt = rpcResult?.result;

        if (!receipt) {
          throw new Error("Transaction receipt not found on Base RPC");
        }

        // Check receipt status: 0x1 indicates success
        if (receipt.status !== "0x1" && receipt.status !== 1) {
          throw new Error("Base transaction failed on-chain (status reverted)");
        }

        // Verify recipient log if logs are present
        if (options.verifyLogs !== false && Array.isArray(receipt.logs) && receipt.logs.length > 0) {
          // Standard ERC-20 Transfer topic: 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef
          const transferTopic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
          const merchantPadded = "0x" + merchantWallet.replace(/^0x/, "").padStart(64, "0").toLowerCase();

          const hasMerchantTransfer = receipt.logs.some(log =>
            Array.isArray(log.topics) &&
            log.topics[0]?.toLowerCase() === transferTopic &&
            log.topics[2]?.toLowerCase() === merchantPadded
          );

          if (!hasMerchantTransfer && options.strictMerchantCheck) {
            throw new Error(`Transaction does not transfer funds to merchant wallet ${merchantWallet}`);
          }
        }
      } catch (err) {
        if (!allowSim) {
          throw new Error(`On-chain Base verification failed: ${err.message}`);
        }
      }
    } else if (!allowSim) {
      throw new Error("Production Base USDC settlement requires active BASE_RPC_URL for on-chain verification");
    }

    return {
      valid: true,
      rail: "base_usdc",
      network: "base",
      asset: "USDC",
      tx_hash: txHash,
      paymentId: txHash,
      amount: expectedAmount ?? proofAmount,
      payer: proof.payer || proof.payer_wallet || "evm-wallet",
      verifiedAt: new Date().toISOString()
    };
  }

  // --- Simulated / Mock x402 Proof ---
  if (proof.status === "PAID") {
    if (!allowSim) {
      throw new Error("Simulated payment proofs are forbidden in production environment. Provide verified Base USDC tx_hash or Lightning preimage.");
    }

    return {
      valid: true,
      rail: "simulated_x402",
      paymentId: proof.paymentId || ("sim_pay_" + Date.now()),
      amount: expectedAmount ?? proofAmount,
      payer: proof.payer || "simulated-agent",
      verifiedAt: new Date().toISOString()
    };
  }

  throw new Error(`Unsupported or unverified settlement rail: ${rail}`);
}
