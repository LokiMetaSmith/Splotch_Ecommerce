import { jest } from '@jest/globals';
import {
  calcWeight,
  calcShippingEstimate,
  calcTax,
  calcSquareFee,
  calcTotal,
  calcOrderBreakdown,
  DEFAULT_USPS_TIERS,
  DEFAULT_SHIPPING_CONFIG,
} from '../server/lib/costCalc.js';

describe('costCalc - calcWeight', () => {
  it('should compute weight from area + tare', () => {
    const result = calcWeight({ areaInSqIn: 100, gramsPerSqIn: 0.05, tareGrams: 28 });
    // 100 * 0.05 + 28 = 33 g; 33 / 28.3495 = ~1.164 oz
    expect(result.weightGrams).toBeCloseTo(33, 5);
    expect(result.weightOz).toBeCloseTo(33 / 28.3495, 4);
  });

  it('should use defaults when options are omitted', () => {
    const result = calcWeight({ areaInSqIn: 0 });
    expect(result.weightGrams).toBe(28);
    expect(result.weightOz).toBeCloseTo(28 / 28.3495, 4);
  });
});

describe('costCalc - calcShippingEstimate', () => {
  it('should return First Class rate for 1 oz package', () => {
    const result = calcShippingEstimate({ weightOz: 0.5 }); // below minimum -> treated as 1 oz
    expect(result.rateCents).toBe(430);
    expect(result.label).toContain('First Class');
  });

  it('should return Priority Mail rate for 20 oz package', () => {
    const result = calcShippingEstimate({ weightOz: 20 });
    expect(result.rateCents).toBe(1050);
    expect(result.label).toContain('Priority Mail');
  });

  it('should enforce 1 oz minimum billable weight', () => {
    const resultLight = calcShippingEstimate({ weightOz: 0.1 });
    const result1oz = calcShippingEstimate({ weightOz: 1 });
    expect(resultLight.rateCents).toBe(result1oz.rateCents);
  });

  it('should return highest tier for very heavy package', () => {
    const result = calcShippingEstimate({ weightOz: 1000 });
    expect(result.rateCents).toBe(1900);
  });

  it('should use custom tiers if provided', () => {
    const tiers = [
      { maxOz: 10, rateCents: 999 },
      { maxOz: Infinity, rateCents: 1999 },
    ];
    expect(calcShippingEstimate({ weightOz: 5, tiers }).rateCents).toBe(999);
    expect(calcShippingEstimate({ weightOz: 50, tiers }).rateCents).toBe(1999);
  });
});

describe('costCalc - calcTax', () => {
  it('should calculate 8.5% Oklahoma tax', () => {
    const tax = calcTax({ subtotalCents: 1000, shippingCents: 500, taxRate: 0.085 });
    // (1000 + 500) * 0.085 = 127.5 -> 128 cents
    expect(tax).toBe(128);
  });

  it('should return 0 when taxRate is 0', () => {
    expect(calcTax({ subtotalCents: 5000, shippingCents: 500, taxRate: 0 })).toBe(0);
  });
});

describe('costCalc - calcSquareFee', () => {
  it('should calculate 2.9% + $0.30', () => {
    // On $10.00 (1000 cents): ceil(1000 * 0.029) + 30 = ceil(29) + 30 = 59 cents
    const fee = calcSquareFee({ amountCents: 1000, feePercent: 0.029, feeFixedCents: 30 });
    expect(fee).toBe(59);
  });

  it('should use defaults when options are omitted', () => {
    const fee = calcSquareFee({ amountCents: 1000 });
    expect(fee).toBe(59);
  });

  it('should ceil the percentage portion', () => {
    // 1001 * 0.029 = 29.029 -> ceil = 30, + 30 = 60
    const fee = calcSquareFee({ amountCents: 1001, feePercent: 0.029, feeFixedCents: 30 });
    expect(fee).toBe(60);
  });
});

describe('costCalc - calcTotal', () => {
  it('should sum all components', () => {
    const total = calcTotal({
      subtotalCents: 1000,
      shippingCents: 430,
      taxCents: 128,
      handlingCents: 300,
      squareFeeCents: 59,
    });
    expect(total).toBe(1917);
  });
});

describe('costCalc - calcOrderBreakdown', () => {
  it('should return a full breakdown with dollar strings', () => {
    const result = calcOrderBreakdown({
      areaInSqIn: 4,   // 2x2 inch sticker
      subtotalCents: 1000,
      config: DEFAULT_SHIPPING_CONFIG,
    });
    expect(result.totalCents).toBeGreaterThan(result.subtotalCents);
    expect(typeof result.totalDollars).toBe('string');
    expect(result.shippingCents).toBeGreaterThan(0);
    expect(result.taxCents).toBeGreaterThan(0);
    expect(result.handlingCents).toBe(DEFAULT_SHIPPING_CONFIG.handlingFeeCents);
    expect(result.weightOz).toBeGreaterThan(0);
  });

  it('should merge provided config over defaults', () => {
    const customConfig = { ...DEFAULT_SHIPPING_CONFIG, handlingFeeCents: 500 };
    const result = calcOrderBreakdown({ areaInSqIn: 4, subtotalCents: 1000, config: customConfig });
    expect(result.handlingCents).toBe(500);
  });
});
