import fs from 'fs';
import path from 'path';
import { calcOrderBreakdown, DEFAULT_SHIPPING_CONFIG } from '../../src/lib/costCalc.js';

describe('Customer Pricing Display - Estimated Total Price', () => {
    test('index.html contains "Estimated Total Price:" label', () => {
        const htmlPath = path.resolve(process.cwd(), 'index.html');
        const htmlContent = fs.readFileSync(htmlPath, 'utf8');
        expect(htmlContent).toContain('Estimated Total Price:');
        expect(htmlContent).not.toMatch(/>\s*Estimated Price:\s*</i);
    });

    test('src/lib/costCalc.js correctly computes order total estimate with shipping, handling and tax', () => {
        const breakdown = calcOrderBreakdown({
            areaInSqIn: 9, // 3x3 inch sticker
            subtotalCents: 1200, // .00 sticker print
            destinationState: 'OK',
            deliveryMethod: 'ship',
            quantity: 10
        });

        expect(breakdown.subtotalCents).toBe(1200);
        expect(breakdown.shippingCents).toBeGreaterThan(0);
        expect(breakdown.handlingCents).toBeGreaterThan(0);
        expect(breakdown.taxCents).toBeGreaterThan(0);
        expect(breakdown.squareFeeCents).toBeGreaterThan(0);
        expect(breakdown.totalCents).toBe(
            breakdown.subtotalCents +
            breakdown.shippingCents +
            breakdown.taxCents +
            breakdown.handlingCents +
            breakdown.squareFeeCents
        );
        expect(breakdown.totalCents).toBeGreaterThan(breakdown.subtotalCents);
    });

    test('local pickup breakdown removes shipping and applies pickup discount', () => {
        const breakdown = calcOrderBreakdown({
            areaInSqIn: 9,
            subtotalCents: 1200,
            destinationState: 'OK',
            deliveryMethod: 'pickup',
            quantity: 10
        });

        expect(breakdown.shippingCents).toBe(0);
        expect(breakdown.pickupDiscountCents).toBe(300); // Default .00 discount
        expect(breakdown.totalCents).toBeLessThan(
            calcOrderBreakdown({
                areaInSqIn: 9,
                subtotalCents: 1200,
                destinationState: 'OK',
                deliveryMethod: 'ship',
                quantity: 10
            }).totalCents
        );
    });
});
