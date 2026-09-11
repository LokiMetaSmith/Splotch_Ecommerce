/**
 * server/lib/costCalc.js
 *
 * Pure (no I/O) cost calculation helpers for order pricing.
 * All monetary values are in **cents** (integers) to avoid floating-point drift.
 * All weights are in ounces unless otherwise noted.
 */

/**
 * USPS rate tiers based on Pirate Ship published rates (pirateship.com/rates).
 * Each entry means: if weightOz <= maxOz, apply rateCents.
 * Rates reflect USPS Commercial Base / Pirate Ship discounted rates (2026).
 */
export const DEFAULT_USPS_TIERS = [
  { maxOz: 1,        rateCents: 430  }, // First Class <=1 oz
  { maxOz: 2,        rateCents: 470  }, // First Class <=2 oz
  { maxOz: 3,        rateCents: 510  }, // First Class <=3 oz
  { maxOz: 4,        rateCents: 550  }, // First Class <=4 oz
  { maxOz: 8,        rateCents: 680  }, // First Class <=8 oz
  { maxOz: 16,       rateCents: 855  }, // Priority Mail <=1 lb
  { maxOz: 32,       rateCents: 1050 }, // Priority Mail <=2 lb
  { maxOz: 48,       rateCents: 1250 }, // Priority Mail <=3 lb
  { maxOz: 64,       rateCents: 1450 }, // Priority Mail <=4 lb
  { maxOz: Infinity, rateCents: 1900 }, // Priority Mail >4 lb (flat fallback)
];

/**
 * Compute estimated package weight in ounces.
 * @param {Object} opts
 * @param {number} opts.areaInSqIn     Total printed sticker area in square inches
 * @param {number} [opts.gramsPerSqIn] Material weight factor (default 0.05 g/in2 for 3 mil vinyl)
 * @param {number} [opts.tareGrams]    Fixed packaging tare weight in grams (default 28 g ~= 1 oz)
 * @returns {{ weightGrams: number, weightOz: number }}
 */
export function calcWeight({ areaInSqIn, gramsPerSqIn = 0.05, tareGrams = 28 }) {
  const stickerGrams = areaInSqIn * gramsPerSqIn;
  const totalGrams = stickerGrams + tareGrams;
  const weightOz = totalGrams / 28.3495;
  return { weightGrams: totalGrams, weightOz };
}

/**
 * Look up the USPS shipping rate for a given weight.
 * @param {Object} opts
 * @param {number} opts.weightOz         Package weight in ounces
 * @param {Array}  [opts.tiers]          Rate tier table (defaults to DEFAULT_USPS_TIERS)
 * @returns {{ rateCents: number, label: string }}
 */
export function calcShippingEstimate({ weightOz, tiers = DEFAULT_USPS_TIERS }) {
  const minWeight = Math.max(weightOz, 1); // USPS First Class minimum is 1 oz
  const tier = tiers.find(t => minWeight <= t.maxOz);
  const rateCents = tier ? tier.rateCents : tiers[tiers.length - 1].rateCents;

  let label;
  if (minWeight <= 8) {
    label = `USPS First Class (~${Math.ceil(minWeight)} oz)`;
  } else {
    const lbs = (minWeight / 16).toFixed(1);
    label = `USPS Priority Mail (~${lbs} lb)`;
  }

  return { rateCents, label };
}

/**
 * Calculate tax in cents.
 * @param {Object} opts
 * @param {number} opts.subtotalCents  Print cost in cents
 * @param {number} opts.shippingCents  Shipping cost in cents
 * @param {number} opts.taxRate        Decimal tax rate (e.g. 0.085 for 8.5%)
 * @returns {number} taxCents (rounded to nearest cent)
 */
export function calcTax({ subtotalCents, shippingCents, taxRate }) {
  return Math.round((subtotalCents + shippingCents) * taxRate);
}

/**
 * Calculate Square payment processing fee in cents.
 * Formula: ceil(amount * feePercent) + feeFixed
 * @param {Object} opts
 * @param {number} opts.amountCents     Amount being charged (before fee) in cents
 * @param {number} [opts.feePercent]    Processing percentage (default 0.029 = 2.9%)
 * @param {number} [opts.feeFixedCents] Fixed per-transaction fee in cents (default 30)
 * @returns {number} feeCents
 */
export function calcSquareFee({ amountCents, feePercent = 0.029, feeFixedCents = 30 }) {
  return Math.ceil(amountCents * feePercent) + feeFixedCents;
}

/**
 * Sum all cost components into a grand total.
 * @param {Object} opts
 * @returns {number} totalCents
 */
export function calcTotal({ subtotalCents, shippingCents, taxCents, handlingCents, squareFeeCents }) {
  return subtotalCents + shippingCents + taxCents + handlingCents + squareFeeCents;
}

/**
 * Default shipping configuration values.
 * Used when no config has been saved to the database yet.
 */
export const DEFAULT_SHIPPING_CONFIG = {
  taxRate: 0.085,           // Oklahoma 8.5%
  handlingFeeCents: 300,    // $3.00 minimum
  squareFeePercent: 0.029,  // 2.9%
  squareFeeFixedCents: 30,  // $0.30
  gramsPerSqIn: 0.05,       // 3 mil vinyl
  packageTareGrams: 28,     // ~1 oz envelope + backing
};

/**
 * Run a full cost breakdown for an order.
 * @param {Object} opts
 * @param {number} opts.areaInSqIn      Total sticker area in square inches
 * @param {number} opts.subtotalCents   Print cost in cents
 * @param {Object} [opts.config]        Shipping config (falls back to DEFAULT_SHIPPING_CONFIG)
 * @param {Array}  [opts.tiers]         USPS tier table override
 * @returns {Object} Full breakdown with cents and dollar string fields
 */
export function calcOrderBreakdown({ areaInSqIn, subtotalCents, config = {}, tiers }) {
  const cfg = { ...DEFAULT_SHIPPING_CONFIG, ...config };

  const { weightGrams, weightOz } = calcWeight({
    areaInSqIn,
    gramsPerSqIn: cfg.gramsPerSqIn,
    tareGrams: cfg.packageTareGrams,
  });

  const { rateCents: shippingCents, label: shippingLabel } = calcShippingEstimate({
    weightOz,
    tiers,
  });

  const taxCents = calcTax({ subtotalCents, shippingCents, taxRate: cfg.taxRate });
  const handlingCents = cfg.handlingFeeCents;

  const preTotalCents = subtotalCents + shippingCents + taxCents + handlingCents;
  const squareFeeCents = calcSquareFee({
    amountCents: preTotalCents,
    feePercent: cfg.squareFeePercent,
    feeFixedCents: cfg.squareFeeFixedCents,
  });

  const totalCents = calcTotal({ subtotalCents, shippingCents, taxCents, handlingCents, squareFeeCents });

  return {
    weightGrams: Math.round(weightGrams * 10) / 10,
    weightOz:    Math.round(weightOz * 100) / 100,
    subtotalCents,
    shippingCents,
    shippingLabel,
    taxCents,
    taxRate: cfg.taxRate,
    handlingCents,
    squareFeeCents,
    totalCents,
    subtotalDollars:   (subtotalCents   / 100).toFixed(2),
    shippingDollars:   (shippingCents   / 100).toFixed(2),
    taxDollars:        (taxCents        / 100).toFixed(2),
    handlingDollars:   (handlingCents   / 100).toFixed(2),
    squareFeeDollars:  (squareFeeCents  / 100).toFixed(2),
    totalDollars:      (totalCents      / 100).toFixed(2),
  };
}

