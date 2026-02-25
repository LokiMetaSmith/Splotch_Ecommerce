/**
 * @jest-environment jsdom
 */
import { jest } from '@jest/globals';
import { setupKeyboardShortcuts } from '../../src/ux-enhancements.js';

describe('Keyboard Shortcuts', () => {
    let rotateLeftSpy, rotateRightSpy, grayscaleSpy, sepiaSpy, sliderInputSpy;

    beforeEach(() => {
        // Reset DOM
        document.body.innerHTML = `
            <button id="rotateLeftBtn" data-tooltip="Rotate Left"></button>
            <button id="rotateRightBtn" data-tooltip="Rotate Right"></button>
            <button id="grayscaleBtn" data-tooltip="Grayscale"></button>
            <button id="sepiaBtn" data-tooltip="Sepia"></button>
            <input type="range" id="resizeSlider" value="3.0" step="0.1" />
            <input type="text" id="textInput" />
            <textarea id="textArea"></textarea>
        `;

        // Initialize shortcuts (assuming idempotent or handled)
        setupKeyboardShortcuts();

        // Spy on click methods
        const leftBtn = document.getElementById('rotateLeftBtn');
        const rightBtn = document.getElementById('rotateRightBtn');
        const grayBtn = document.getElementById('grayscaleBtn');
        const sepiaBtn = document.getElementById('sepiaBtn');
        const slider = document.getElementById('resizeSlider');

        rotateLeftSpy = jest.spyOn(leftBtn, 'click');
        rotateRightSpy = jest.spyOn(rightBtn, 'click');
        grayscaleSpy = jest.spyOn(grayBtn, 'click');
        sepiaSpy = jest.spyOn(sepiaBtn, 'click');

        // Mock slider dispatchEvent
        sliderInputSpy = jest.fn();
        slider.dispatchEvent = sliderInputSpy;
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    test('activates rotate left on [', () => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: '[' }));
        expect(rotateLeftSpy).toHaveBeenCalled();
    });

    test('activates rotate right on ]', () => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: ']' }));
        expect(rotateRightSpy).toHaveBeenCalled();
    });

    test('activates grayscale on g', () => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'g' }));
        expect(grayscaleSpy).toHaveBeenCalled();
    });

    test('activates sepia on s', () => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 's' }));
        expect(sepiaSpy).toHaveBeenCalled();
    });

    test('increases slider on Shift+ArrowUp', () => {
        const slider = document.getElementById('resizeSlider');
        const event = new KeyboardEvent('keydown', { key: 'ArrowUp', shiftKey: true });
        document.dispatchEvent(event);

        expect(parseFloat(slider.value)).toBeCloseTo(3.1);
        expect(sliderInputSpy).toHaveBeenCalled();
    });

    test('decreases slider on Shift+ArrowDown', () => {
        const slider = document.getElementById('resizeSlider');
        const event = new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true });
        document.dispatchEvent(event);

        expect(parseFloat(slider.value)).toBeCloseTo(2.9);
        expect(sliderInputSpy).toHaveBeenCalled();
    });

    test('ignores shortcuts when typing in input', () => {
        const input = document.getElementById('textInput');
        input.focus();
        // Dispatch event on input element to simulate typing
        input.dispatchEvent(new KeyboardEvent('keydown', { key: '[', bubbles: true }));

        expect(rotateLeftSpy).not.toHaveBeenCalled();
    });

    test('ignores shortcuts when typing in textarea', () => {
        const textarea = document.getElementById('textArea');
        textarea.focus();
        textarea.dispatchEvent(new KeyboardEvent('keydown', { key: ']', bubbles: true }));

        expect(rotateRightSpy).not.toHaveBeenCalled();
    });

    test('updates tooltips with shortcuts', () => {
        const leftBtn = document.getElementById('rotateLeftBtn');
        expect(leftBtn.dataset.tooltip).toContain('[');

        const rightBtn = document.getElementById('rotateRightBtn');
        expect(rightBtn.dataset.tooltip).toContain(']');
    });
});
