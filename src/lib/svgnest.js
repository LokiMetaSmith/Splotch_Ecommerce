// /lib/svgnest.js

/*!
 * SvgNest - Modern ES Module Version
 * Licensed under the MIT license
 */

'use strict';

import { SVGParser } from './svgparser.js';
import { GeometryUtil } from './geometryutil.js';
import { PlacementWorker } from './placementworker.js';

class GeneticAlgorithm {
    constructor(adam, bin, config) {
        this.config = config || { populationSize: 10, mutationRate: 10, rotations: 4 };
        this.binBounds = GeometryUtil.getPolygonBounds(bin);

        const angles = [];
        for (let i = 0; i < adam.length; i++) {
            angles.push(this.randomAngle(adam[i]));
}

        this.population = [{ placement: adam, rotation: angles }];

        while (this.population.length < this.config.populationSize) {
            const mutant = this.mutate(this.population[0]);
            this.population.push(mutant);
        }
    }

    randomAngle(part) {
        const angleList = [];
        for (let i = 0; i < Math.max(this.config.rotations, 1); i++) {
            angleList.push(i * (360 / this.config.rotations));
        }

        // Fisher-Yates shuffle
        for (let i = angleList.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [angleList[i], angleList[j]] = [angleList[j], angleList[i]];
        }

        for (const angle of angleList) {
            const rotatedPart = GeometryUtil.rotatePolygon(part, angle);
            const rotatedBounds = GeometryUtil.getPolygonBounds(rotatedPart);
            if (rotatedBounds.width < this.binBounds.width && rotatedBounds.height < this.binBounds.height) {
                return angle;
            }
        }
        return 0;
    }

    mutate(individual) {
        const clone = { placement: individual.placement.slice(0), rotation: individual.rotation.slice(0) };
        for (let i = 0; i < clone.placement.length; i++) {
            if (Math.random() < 0.01 * this.config.mutationRate) {
                const j = i + 1;
                if (j < clone.placement.length) {
                    [clone.placement[i], clone.placement[j]] = [clone.placement[j], clone.placement[i]];
                }
            }
            if (Math.random() < 0.01 * this.config.mutationRate) {
                clone.rotation[i] = this.randomAngle(clone.placement[i]);
            }
        }
        return clone;
    }

    mate(male, female) {
        const cutpoint = Math.round(Math.min(Math.max(Math.random(), 0.1), 0.9) * (male.placement.length - 1));
        const gene1 = male.placement.slice(0, cutpoint);
        const rot1 = male.rotation.slice(0, cutpoint);
        const gene2 = female.placement.slice(0, cutpoint);
        const rot2 = female.rotation.slice(0, cutpoint);

        const contains = (gene, id) => gene.some(p => p.id === id);

        for (let i = 0; i < female.placement.length; i++) {
            if (!contains(gene1, female.placement[i].id)) {
                gene1.push(female.placement[i]);
                rot1.push(female.rotation[i]);
            }
        }

        for (let i = 0; i < male.placement.length; i++) {
            if (!contains(gene2, male.placement[i].id)) {
                gene2.push(male.placement[i]);
                rot2.push(male.rotation[i]);
            }
        }
        return [{ placement: gene1, rotation: rot1 }, { placement: gene2, rotation: rot2 }];
    }
    
    generation() {
        this.population.sort((a, b) => a.fitness - b.fitness);
        const newPopulation = [this.population[0]];

        while (newPopulation.length < this.population.length) {
            const male = this.randomWeightedIndividual();
            const female = this.randomWeightedIndividual(male);
            const children = this.mate(male, female);
            newPopulation.push(this.mutate(children[0]));

            if (newPopulation.length < this.population.length) {
                newPopulation.push(this.mutate(children[1]));
            }
        }
        this.population = newPopulation;
    }

    randomWeightedIndividual(exclude) {
        let pop = this.population.slice(0);
        if (exclude) {
            pop = pop.filter(individual => individual !== exclude);
        }

        const rand = Math.random();
        let lower = 0;
        const weight = 1 / pop.length;
        let upper = weight;

        for (let i = 0; i < pop.length; i++) {
            if (rand > lower && rand < upper) {
                return pop[i];
            }
            lower = upper;
            upper += 2 * weight * ((pop.length - i) / pop.length);
        }
        return pop[0];
    }
}


export class SvgNest {
    constructor(binElement, svgElements, options) {
        this.svgParser = new SVGParser();
        this.configure(options);
        
        if (binElement) {
            this.setBin(binElement);
        }
        if (svgElements) {
            this.addParts(svgElements);
        }
    }

    configure(c) {
        this.config = {
            clipperScale: 10000000,
            curveTolerance: 0.3,
            spacing: 0,
            rotations: 4,
            populationSize: 10,
            mutationRate: 10,
            useHoles: false,
            exploreConcave: false,
            ...(c || {})
        };
        
        this.svgParser.config({ tolerance: this.config.curveTolerance });

        this.best = null;
        this.nfpCache = {};
        this.binPolygon = null;
        this.GA = null;
        return this.config;
    }

    addParts(elements) {
        this.tree = this._getParts(elements);
    }
    
    setBin(element) {
        this.bin = element;
        this.binPolygon = this.svgParser.polygonify(this.bin);
        this.binPolygon = this._cleanPolygon(this.binPolygon);

        if (!this.binPolygon || this.binPolygon.length < 3) {
            console.error("Bin polygon is not valid.");
            this.binPolygon = null;
            return;
        }

        this.binBounds = GeometryUtil.getPolygonBounds(this.binPolygon);
    }

    setBinPolygon(polygon) {
        // A new method to accept a pre-computed polygon
        this.binPolygon = this._cleanPolygon(polygon);

        if (!this.binPolygon || this.binPolygon.length < 3) {
            console.error("Bin polygon is not valid.");
            this.binPolygon = null;
            return;
        }

        this.binBounds = GeometryUtil.getPolygonBounds(this.binPolygon);
    }

    start() {
        if (!this.binPolygon || !this.tree || this.tree.length === 0) {
            console.error("Bin or parts not set or empty.");
            return '';
        }

        // The original logic uses web workers via Parallel.js
        // This is a simplified synchronous version for demonstration
        const adam = this.tree.slice(0);
        adam.sort((a, b) => Math.abs(GeometryUtil.polygonArea(b)) - Math.abs(GeometryUtil.polygonArea(a)));

        this.GA = new GeneticAlgorithm(adam, this.binPolygon, this.config);
        const individual = this.GA.population[0];
        
        const worker = new PlacementWorker(this.binPolygon, this.tree, individual.placement.map(p => p.id), individual.rotation, this.config, {});
        const result = worker.placePaths(individual.placement);
        
        this.best = result;
        return this.applyPlacement(this.best.placements);
    }

    applyPlacement(placements) {
        if (!placements || placements.length === 0) return '';
        
        const newSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        newSvg.setAttribute('viewBox', `0 0 ${this.binBounds.width} ${this.binBounds.height}`);
        newSvg.setAttribute('width', `${this.binBounds.width}px`);
        newSvg.setAttribute('height', `${this.binBounds.height}px`);

        const placedGroup = placements[0]; // Assuming one bin
        placedGroup.forEach(p => {
            const originalElement = this.tree.find(part => part.id === p.id)?.element;
            if (originalElement) {
                const clone = originalElement.cloneNode(true);
                clone.setAttribute('transform', `translate(${p.x} ${p.y}) rotate(${p.rotation})`);
                newSvg.appendChild(clone);
            }
        });
        
        // --- Add Printing Marks ---
        if (this.config.addPrintingMarks) {
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

            placedGroup.forEach(p => {
                const originalPart = this.tree.find(part => part.id === p.id);
                // We need to rotate the polygon to get accurate bounds
                const rotatedPart = GeometryUtil.rotatePolygon(originalPart, p.rotation);
                const partBounds = GeometryUtil.getPolygonBounds(rotatedPart);

                // Placement x, y corresponds to the origin (0,0) of the part's coordinate system.
                // We need to add the rotated part's bounds offset (which might be negative) to get the visual edges.
                const absMinX = p.x + partBounds.x;
                const absMinY = p.y + partBounds.y;
                const absMaxX = p.x + partBounds.x + partBounds.width;
                const absMaxY = p.y + partBounds.y + partBounds.height;

                if (absMinX < minX) minX = absMinX;
                if (absMinY < minY) minY = absMinY;
                if (absMaxX > maxX) maxX = absMaxX;
                if (absMaxY > maxY) maxY = absMaxY;
            });

            // If no parts placed, skip marks
            if (minX !== Infinity) {
                const bounds = {
                    left: minX,
                    top: minY,
                    right: maxX,
                    bottom: maxY,
                };

                const markLength = 20; // Length of the crop mark lines
                const markOffset = 10; // Distance from the bounding box

                const createMark = (d) => {
                    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
                    path.setAttribute('d', d);
                    path.setAttribute('stroke', 'black');
                    path.setAttribute('stroke-width', '1');
                    path.setAttribute('fill', 'none');
                    return path;
                };

                // Top-left
                newSvg.appendChild(createMark(`M ${bounds.left - markOffset} ${bounds.top - markOffset - markLength} L ${bounds.left - markOffset} ${bounds.top - markOffset}`));
                newSvg.appendChild(createMark(`M ${bounds.left - markOffset - markLength} ${bounds.top - markOffset} L ${bounds.left - markOffset} ${bounds.top - markOffset}`));
                // Top-right
                newSvg.appendChild(createMark(`M ${bounds.right + markOffset} ${bounds.top - markOffset - markLength} L ${bounds.right + markOffset} ${bounds.top - markOffset}`));
                newSvg.appendChild(createMark(`M ${bounds.right + markOffset + markLength} ${bounds.top - markOffset} L ${bounds.right + markOffset} ${bounds.top - markOffset}`));
                // Bottom-left
                newSvg.appendChild(createMark(`M ${bounds.left - markOffset} ${bounds.bottom + markOffset + markLength} L ${bounds.left - markOffset} ${bounds.bottom + markOffset}`));
                newSvg.appendChild(createMark(`M ${bounds.left - markOffset - markLength} ${bounds.bottom + markOffset} L ${bounds.left - markOffset} ${bounds.bottom + markOffset}`));
                // Bottom-right
                newSvg.appendChild(createMark(`M ${bounds.right + markOffset} ${bounds.bottom + markOffset + markLength} L ${bounds.right + markOffset} ${bounds.bottom + markOffset}`));
                newSvg.appendChild(createMark(`M ${bounds.right + markOffset + markLength} ${bounds.bottom + markOffset} L ${bounds.right + markOffset} ${bounds.bottom + markOffset}`));
            }
        }


        const serializer = new XMLSerializer();
        return serializer.serializeToString(newSvg);
    }

    _getParts(elements) {
        const polygons = [];
        let idCounter = 0;
        
        const processElement = (el) => {
            // Recurse into containers
            if (['svg', 'g', 'defs', 'symbol'].includes(el.tagName)) {
                Array.from(el.children).forEach(child => processElement(child));
                return;
            }

            // Attempt to polygonify shape elements
            const poly = this.svgParser.polygonify(el);

            if (poly && poly.length > 0) {
                const cleanedPoly = this._cleanPolygon(poly);

                if (cleanedPoly && cleanedPoly.length > 2 && Math.abs(GeometryUtil.polygonArea(cleanedPoly)) > this.config.curveTolerance * this.config.curveTolerance) {
                    cleanedPoly.id = idCounter++;
                    cleanedPoly.element = el; // Keep reference to original DOM element
                    polygons.push(cleanedPoly);
                } else {
                     console.warn(`Part skipped: Area too small or invalid.`);
                }
            }
        };

        elements.forEach(element => {
            processElement(element);
        });

        if (polygons.length === 0) {
            console.warn("No valid parts found in provided elements.");
        }

        return polygons;
    }

    _cleanPolygon(polygon) {
        // Uses ClipperLib global
        if (!window.ClipperLib) {
            console.error("ClipperLib is not loaded.");
            return polygon;
        }
        
        const scale = this.config.clipperScale;
        const scaledPoly = polygon.map(p => ({ X: p.x * scale, Y: p.y * scale }));
        const simple = ClipperLib.Clipper.SimplifyPolygon(scaledPoly, ClipperLib.PolyFillType.pftNonZero);

        if (!simple || simple.length === 0) {
             return null;
        }
        
        let biggest = simple[0];
        let maxArea = Math.abs(ClipperLib.Clipper.Area(biggest));

        for (let i = 1; i < simple.length; i++) {
            const area = Math.abs(ClipperLib.Clipper.Area(simple[i]));
            if (area > maxArea) {
                biggest = simple[i];
                maxArea = area;
            }
        }

        const clean = ClipperLib.Clipper.CleanPolygon(biggest, this.config.curveTolerance * scale);
        
        if (!clean || clean.length === 0) {
             return null;
        }
        
        return clean.map(p => ({ x: p.X / scale, y: p.Y / scale }));
    }
}
