
import { jest, describe, it, expect } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { JSDOM } from 'jsdom';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Mock JSDOM
const dom = new JSDOM('<!DOCTYPE html>');
global.window = dom.window;
global.document = dom.window.document;
global.DOMParser = dom.window.DOMParser;
global.XMLSerializer = dom.window.XMLSerializer;
global.self = global;

// Load ClipperLib
const clipperPath = path.resolve(__dirname, '../src/lib/clipper.js');
const clipperContent = fs.readFileSync(clipperPath, 'utf8');
try {
    // eslint-disable-next-line no-eval
    eval(clipperContent);
} catch {
    // ignore
}
if (!window.ClipperLib) window.ClipperLib = global.ClipperLib || self.ClipperLib;

// Mock PlacementWorker
jest.unstable_mockModule('../src/lib/placementworker.js', () => ({
  PlacementWorker: jest.fn().mockImplementation(() => ({
    placePaths: jest.fn().mockReturnValue({ placements: [] })
  }))
}));

const { SvgNest, GeneticAlgorithm } = await import('../src/lib/svgnest.js');

describe('SvgNest start() optimization', () => {
    it('should force populationSize to 1 to avoid generating unused mutants', () => {
        // Setup simple data
        const binPolygon = [{x:0, y:0}, {x:100, y:0}, {x:100, y:100}, {x:0, y:100}];
        const parts = [
            [{x:10,y:10}, {x:20,y:10}, {x:20,y:20}, {x:10,y:20}]
        ];
        // Add ID as required by GeneticAlgorithm
        parts[0].id = 0;

        const nest = new SvgNest();
        nest.binPolygon = binPolygon;
        nest.binBounds = { x:0, y:0, width:100, height:100 };
        nest.tree = parts;

        // Spy on GeneticAlgorithm mutation
        const mutateSpy = jest.spyOn(GeneticAlgorithm.prototype, 'mutate');

        nest.start();

        // Expectation: 0 calls to mutate
        expect(mutateSpy).toHaveBeenCalledTimes(0);
    });
});
