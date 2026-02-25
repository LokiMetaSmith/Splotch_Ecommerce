/**
 * @jest-environment jsdom
 */
import { setupShortcutsHelp } from '../../src/ux-enhancements.js';

describe('Keyboard Shortcuts Help Modal', () => {
  let container;

  beforeEach(() => {
    // Set up the DOM structure required by the function
    document.body.innerHTML = `
      <div class="flex justify-between items-center">
        <div class="flex space-x-2">
           <button id="sellDesignBtn">Sell this Design</button>
        </div>
      </div>
    `;
    container = document.getElementById('sellDesignBtn').parentNode;
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('injects the help button into the header', () => {
    setupShortcutsHelp();
    const btn = document.getElementById('shortcutsBtn');
    expect(btn).not.toBeNull();
    expect(container.contains(btn)).toBe(true);
  });

  test('does not duplicate the button if called twice', () => {
    setupShortcutsHelp();
    setupShortcutsHelp();
    const btns = document.querySelectorAll('#shortcutsBtn');
    expect(btns.length).toBe(1);
  });

  test('creates the modal in the body', () => {
    setupShortcutsHelp();
    const modal = document.getElementById('shortcutsModal');
    expect(modal).not.toBeNull();
    expect(document.body.contains(modal)).toBe(true);
    expect(modal.classList.contains('hidden')).toBe(true);
  });

  test('opens the modal when button is clicked', () => {
    setupShortcutsHelp();
    const btn = document.getElementById('shortcutsBtn');
    const modal = document.getElementById('shortcutsModal');

    btn.click();
    expect(modal.classList.contains('hidden')).toBe(false);
  });

  test('closes the modal when close button is clicked', () => {
    setupShortcutsHelp();
    const btn = document.getElementById('shortcutsBtn');
    const modal = document.getElementById('shortcutsModal');

    // Open it first
    btn.click();
    expect(modal.classList.contains('hidden')).toBe(false);

    // Find close button (x)
    const closeX = modal.querySelector('.close-modal');
    closeX.click();
    expect(modal.classList.contains('hidden')).toBe(true);
  });

  test('closes the modal when "Got it!" button is clicked', () => {
    setupShortcutsHelp();
    const btn = document.getElementById('shortcutsBtn');
    const modal = document.getElementById('shortcutsModal');

    btn.click();
    const closeBtn = modal.querySelector('.close-modal-btn');
    closeBtn.click();
    expect(modal.classList.contains('hidden')).toBe(true);
  });

  test('closes the modal when clicking outside', () => {
    setupShortcutsHelp();
    const btn = document.getElementById('shortcutsBtn');
    const modal = document.getElementById('shortcutsModal');

    btn.click();
    modal.click(); // Clicking the background
    expect(modal.classList.contains('hidden')).toBe(true);
  });

  test('closes the modal when pressing Escape', () => {
    setupShortcutsHelp();
    const btn = document.getElementById('shortcutsBtn');
    const modal = document.getElementById('shortcutsModal');

    btn.click();

    const event = new KeyboardEvent('keydown', { key: 'Escape' });
    document.dispatchEvent(event);

    expect(modal.classList.contains('hidden')).toBe(true);
  });
});
