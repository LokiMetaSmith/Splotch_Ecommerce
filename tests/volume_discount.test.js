// tests/volume_discount.test.js

/**
 * @jest-environment jsdom
 */

import { calculateStickerPrice } from '../src/lib/pricing.js';
import { calculateStickerPrice as calculateStickerPriceServer } from '../server/pricing.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pricingConfigJson = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../server/pricing.json'), 'utf8')
);

describe('Sticker Mule Volume Discount Model', () => {
    const resolution = pricingConfigJson.resolutions.find(r => r.id === 'dpi_300') || pricingConfigJson.resolutions[0];
    const ppi = resolution.ppi;
    // 3" x 3" sticker bounds = 9 sq in
    const bounds = { width: 3 * ppi, height: 3 * ppi };
    const cutline = [[
        { x: 0, y: 0 },
        { x: 3 * ppi, y: 0 },
        { x: 3 * ppi, y: 3 * ppi },
        { x: 0, y: 3 * ppi }
    ]];
    const material = 'pp_standard';

    it('should have client and server calculateStickerPrice functions return identical results', () => {
        const quantities = [1, 10, 50, 100, 200, 300, 500, 1000, 2000, 5000, 10000];
        quantities.forEach(qty => {
            const clientResult = calculateStickerPrice(pricingConfigJson, qty, material, bounds, cutline, resolution);
            const serverResult = calculateStickerPriceServer(pricingConfigJson, qty, material, bounds, cutline, resolution);
            expect(clientResult).toEqual(serverResult);
        });
    });

    it('should apply the correct discount percentages across all volume tiers', () => {
        const expectedTiers = [
            { qty: 1, discount: 0 },
            { qty: 25, discount: 0 },
            { qty: 50, discount: 0 },
            { qty: 100, discount: 0.37 },
            { qty: 200, discount: 0.55 },
            { qty: 300, discount: 0.63 },
            { qty: 500, discount: 0.71 },
            { qty: 1000, discount: 0.76 },
            { qty: 2000, discount: 0.81 },
            { qty: 5000, discount: 0.84 },
            { qty: 10000, discount: 0.87 }
        ];

        expectedTiers.forEach(({ qty, discount }) => {
            const res = calculateStickerPrice(pricingConfigJson, qty, material, bounds, cutline, resolution);
            expect(res.discount).toBe(discount);
            expect(res.discountPercent).toBe(Math.round(discount * 100));
        });
    });

    it('should ensure price per sticker strictly decreases as volume increases', () => {
        const tierQuantities = [50, 100, 200, 300, 500, 1000, 2000, 5000, 10000];
        let previousUnitPrice = Infinity;

        tierQuantities.forEach(qty => {
            const res = calculateStickerPrice(pricingConfigJson, qty, material, bounds, cutline, resolution);
            const unitPrice = res.total / qty;
            expect(unitPrice).toBeLessThan(previousUnitPrice);
            previousUnitPrice = unitPrice;
        });
    });

    it('should ensure total cost increases monotonically (buying more never costs less total dollars)', () => {
        const sampleQuantities = [1, 10, 49, 50, 99, 100, 199, 200, 499, 500, 999, 1000, 1999, 2000, 5000, 10000];
        let previousTotal = 0;

        sampleQuantities.forEach(qty => {
            const res = calculateStickerPrice(pricingConfigJson, qty, material, bounds, cutline, resolution);
            expect(res.total).toBeGreaterThanOrEqual(previousTotal);
            previousTotal = res.total;
        });
    });

    it('should compute exact savings and undiscounted totals', () => {
        const qty = 500;
        const res = calculateStickerPrice(pricingConfigJson, qty, material, bounds, cutline, resolution);

        expect(res.discountPercent).toBe(71);
        expect(res.undiscountedTotal).toBeGreaterThan(res.total);
        expect(res.savingsCents).toBe(res.undiscountedTotal - res.total);
        expect(res.unitPriceCents).toBe(Math.round(res.total / qty));
    });

    it('should be order-independent regardless of how quantityDiscounts array is sorted', () => {
        const configReversed = {
            ...pricingConfigJson,
            quantityDiscounts: [...pricingConfigJson.quantityDiscounts].reverse()
        };
        const configShuffled = {
            ...pricingConfigJson,
            quantityDiscounts: [...pricingConfigJson.quantityDiscounts].sort(() => 0.5 - Math.random())
        };

        const qty = 500;
        const baseResult = calculateStickerPrice(pricingConfigJson, qty, material, bounds, cutline, resolution);
        const reversedResult = calculateStickerPrice(configReversed, qty, material, bounds, cutline, resolution);
        const shuffledResult = calculateStickerPrice(configShuffled, qty, material, bounds, cutline, resolution);

        expect(reversedResult.discount).toBe(baseResult.discount);
        expect(reversedResult.total).toBe(baseResult.total);
        expect(shuffledResult.discount).toBe(baseResult.discount);
        expect(shuffledResult.total).toBe(baseResult.total);
    });
});
