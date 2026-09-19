import { jest, describe, it, expect } from '@jest/globals';
import { calcOrderBreakdown, DEFAULT_SHIPPING_CONFIG } from '../server/lib/costCalc.js';

describe('costCalc - Promo Code Discounts', () => {
  const baseOptions = {
    areaInSqIn: 10,
    subtotalCents: 1000, // $10.00
    config: DEFAULT_SHIPPING_CONFIG,
    destinationState: 'OK',
    deliveryMethod: 'ship',
  };

  it('should apply percentage discount accurately', () => {
    const promoConfig = {
      enabled: true,
      code: 'SAVE20',
      type: 'percentage',
      amount: 20, // 20%
      maxUses: 100,
      timesUsed: 5,
    };

    const breakdown = calcOrderBreakdown({
      ...baseOptions,
      promoConfig,
      promoCode: 'SAVE20',
    });

    expect(breakdown.isPromoApplied).toBe(true);
    expect(breakdown.appliedPromoCode).toBe('SAVE20');
    expect(breakdown.promoDiscountCents).toBe(200); // 20% of 1000 = 200 cents
    expect(breakdown.promoDiscountDollars).toBe('2.00');
    // Discounted subtotal should be 800 cents
    expect(breakdown.discountedSubtotalCents).toBe(800);
  });

  it('should match promo codes case-insensitively with trimming', () => {
    const promoConfig = {
      enabled: true,
      code: 'SUMMER50',
      type: 'percentage',
      amount: 50,
      maxUses: null,
      timesUsed: 0,
    };

    const breakdown = calcOrderBreakdown({
      ...baseOptions,
      promoConfig,
      promoCode: '  summer50  ',
    });

    expect(breakdown.isPromoApplied).toBe(true);
    expect(breakdown.appliedPromoCode).toBe('SUMMER50');
    expect(breakdown.promoDiscountCents).toBe(500);
  });

  it('should apply flat dollar discount converted to cents', () => {
    const promoConfig = {
      enabled: true,
      code: 'FLAT3',
      type: 'flat',
      amount: 3.5, // $3.50 off
      maxUses: null,
      timesUsed: 0,
    };

    const breakdown = calcOrderBreakdown({
      ...baseOptions,
      promoConfig,
      promoCode: 'FLAT3',
    });

    expect(breakdown.isPromoApplied).toBe(true);
    expect(breakdown.promoDiscountCents).toBe(350);
    expect(breakdown.promoDiscountDollars).toBe('3.50');
    expect(breakdown.discountedSubtotalCents).toBe(650);
  });

  it('should cap promo discount at subtotal so price never goes below zero', () => {
    const promoConfig = {
      enabled: true,
      code: 'HUGE50',
      type: 'flat',
      amount: 50.0, // $50 off on $10 order
      maxUses: null,
      timesUsed: 0,
    };

    const breakdown = calcOrderBreakdown({
      ...baseOptions,
      subtotalCents: 1000,
      promoConfig,
      promoCode: 'HUGE50',
    });

    expect(breakdown.isPromoApplied).toBe(true);
    expect(breakdown.promoDiscountCents).toBe(1000); // capped at subtotal
    expect(breakdown.discountedSubtotalCents).toBe(0);
    expect(breakdown.totalCents).toBeGreaterThan(0); // shipping/handling still charged
  });

  it('should not apply promo if enabled is false', () => {
    const promoConfig = {
      enabled: false,
      code: 'DISABLED',
      type: 'percentage',
      amount: 25,
      maxUses: null,
      timesUsed: 0,
    };

    const breakdown = calcOrderBreakdown({
      ...baseOptions,
      promoConfig,
      promoCode: 'DISABLED',
    });

    expect(breakdown.isPromoApplied).toBe(false);
    expect(breakdown.promoDiscountCents).toBe(0);
  });

  it('should not apply promo if maxUses limit has been reached', () => {
    const promoConfig = {
      enabled: true,
      code: 'LIMITED',
      type: 'flat',
      amount: 5,
      maxUses: 10,
      timesUsed: 10, // fully redeemed
    };

    const breakdown = calcOrderBreakdown({
      ...baseOptions,
      promoConfig,
      promoCode: 'LIMITED',
    });

    expect(breakdown.isPromoApplied).toBe(false);
    expect(breakdown.promoDiscountCents).toBe(0);
  });

  it('should calculate sales tax on discounted subtotal', () => {
    const promoConfig = {
      enabled: true,
      code: 'HALF',
      type: 'percentage',
      amount: 50,
      maxUses: null,
      timesUsed: 0,
    };

    const breakdownWithoutPromo = calcOrderBreakdown({
      ...baseOptions,
      subtotalCents: 10000, // $100
      destinationState: 'OK',
    });

    const breakdownWithPromo = calcOrderBreakdown({
      ...baseOptions,
      subtotalCents: 10000, // $100
      destinationState: 'OK',
      promoConfig,
      promoCode: 'HALF',
    });

    // Net taxable subtotal is $50 instead of $100
    expect(breakdownWithPromo.promoDiscountCents).toBe(5000);
    expect(breakdownWithPromo.taxCents).toBeLessThan(breakdownWithoutPromo.taxCents);
  });

  it('should combine cleanly with local pickup discount', () => {
    const promoConfig = {
      enabled: true,
      code: 'LOCAL10',
      type: 'percentage',
      amount: 10,
      maxUses: null,
      timesUsed: 0,
    };

    const breakdown = calcOrderBreakdown({
      ...baseOptions,
      subtotalCents: 5000, // $50
      deliveryMethod: 'pickup',
      promoConfig,
      promoCode: 'LOCAL10',
    });

    expect(breakdown.deliveryMethod).toBe('pickup');
    expect(breakdown.pickupDiscountCents).toBe(300);
    expect(breakdown.isPromoApplied).toBe(true);
    expect(breakdown.promoDiscountCents).toBe(500); // 10% of $50
  });
});
