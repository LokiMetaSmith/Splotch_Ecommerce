// /lib/matrix.js
'use strict';

export class Matrix {
    constructor() {
        this.queue = [];   // list of matrixes to apply
        this.cache = null; // combined matrix cache
    }

    /**
     * Combines two matrices.
     * @param {number[]} m1 - The first matrix [a, b, c, d, e, f].
     * @param {number[]} m2 - The second matrix [a, b, c, d, e, f].
     * @returns {number[]} The combined matrix.
     */
    combine(m1, m2) {
        return [
            m1[0] * m2[0] + m1[2] * m2[1],
            m1[1] * m2[0] + m1[3] * m2[1],
            m1[0] * m2[2] + m1[2] * m2[3],
            m1[1] * m2[2] + m1[3] * m2[3],
            m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
            m1[1] * m2[4] + m1[3] * m2[5] + m1[5]
        ];
    }

    /**
     * Checks if the matrix is an identity matrix.
     * @returns {boolean}
     */
    isIdentity() {
        if (!this.cache) {
            this.cache = this.toArray();
        }
        const m = this.cache;
        return m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0;
    }

    /**
     * Pushes a matrix to the transformation queue.
     * @param {number[]} m - The matrix to add.
     * @returns {this} The Matrix instance for chaining.
     */
    matrix(m) {
        if (m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0) {
            return this;
        }
        this.cache = null;
        this.queue.push(m);
        return this;
    }

    /**
     * Pushes a translation to the transformation queue.
     * @param {number} tx - The x-axis translation.
     * @param {number} ty - The y-axis translation.
     * @returns {this} The Matrix instance for chaining.
     */
    translate(tx, ty) {
        if (tx !== 0 || ty !== 0) {
            this.cache = null;
            this.queue.push([1, 0, 0, 1, tx, ty]);
        }
        return this;
    }

    /**
     * Pushes a scale operation to the transformation queue.
     * @param {number} sx - The x-axis scale factor.
     * @param {number} sy - The y-axis scale factor.
     * @returns {this} The Matrix instance for chaining.
     */
    scale(sx, sy) {
        if (sx !== 1 || sy !== 1) {
            this.cache = null;
            this.queue.push([sx, 0, 0, sy, 0, 0]);
        }
        return this;
    }

    /**
     * Pushes a rotation to the transformation queue.
     * @param {number} angle - The rotation angle in degrees.
     * @param {number} rx - The x-coordinate of the rotation center.
     * @param {number} ry - The y-coordinate of the rotation center.
     * @returns {this} The Matrix instance for chaining.
     */
    rotate(angle, rx, ry) {
        if (angle !== 0) {
            this.translate(rx, ry);
            const rad = angle * Math.PI / 180;
            const cos = Math.cos(rad);
            const sin = Math.sin(rad);
            this.queue.push([cos, sin, -sin, cos, 0, 0]);
            this.cache = null;
            this.translate(-rx, -ry);
        }
        return this;
    }

    /**
     * Pushes a skewX operation to the transformation queue.
     * @param {number} angle - The skew angle in degrees.
     * @returns {this} The Matrix instance for chaining.
     */
    skewX(angle) {
        if (angle !== 0) {
            this.cache = null;
            this.queue.push([1, 0, Math.tan(angle * Math.PI / 180), 1, 0, 0]);
        }
        return this;
    }

    /**
     * Pushes a skewY operation to the transformation queue.
     * @param {number} angle - The skew angle in degrees.
     * @returns {this} The Matrix instance for chaining.
     */
    skewY(angle) {
        if (angle !== 0) {
            this.cache = null;
            this.queue.push([1, Math.tan(angle * Math.PI / 180), 0, 1, 0, 0]);
        }
        return this;
    }

    /**
     * Flattens the queue of transformations into a single matrix array.
     * @returns {number[]} The final matrix as an array.
     */
    toArray() {
        if (this.cache) {
            return this.cache;
        }
        if (!this.queue.length) {
            this.cache = [1, 0, 0, 1, 0, 0];
            return this.cache;
        }
        this.cache = this.queue[0];
        if (this.queue.length === 1) {
            return this.cache;
        }
        for (let i = 1; i < this.queue.length; i++) {
            this.cache = this.combine(this.cache, this.queue[i]);
        }
        return this.cache;
    }

    /**
     * Applies the matrix transformations to a point.
     * @param {number} x - The x-coordinate of the point.
     * @param {number} y - The y-coordinate of the point.
     * @param {boolean} [isRelative=false] - If true, the translate component is skipped.
     * @returns {{x: number, y: number}} The transformed point as {x, y}.
     */
    calc(x, y, isRelative = false) {
        // Optimization: Return object instead of array to reduce memory allocation
        // and GC overhead during heavy matrix operations (e.g. iterating over SVG points).
        if (!this.queue.length) {
            return { x, y };
        }
        if (!this.cache) {
            this.cache = this.toArray();
        }
        const m = this.cache;
        return {
            x: x * m[0] + y * m[2] + (isRelative ? 0 : m[4]),
            y: x * m[1] + y * m[3] + (isRelative ? 0 : m[5])
        };
    }
}