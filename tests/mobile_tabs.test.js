/**
 * @jest-environment jsdom
 */
import { jest } from '@jest/globals';
import { initMobileTabs, switchTab, setupJumpToEditor } from '../src/mobile-tabs.js';

describe('Mobile Tabs & Jump to Sticker Editor', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <nav class="top-menu-bar">
        <a href="#sticker-design-box" class="menu-item" id="jump-to-editor-btn">Jump to Sticker Editor</a>
      </nav>

      <div id="sticker-design-box">
        <div class="flex lg:hidden">
          <button type="button" class="mobile-tab-btn" data-tab="art">1. Art</button>
          <button type="button" class="mobile-tab-btn" data-tab="cutlines">2. Cut</button>
          <button type="button" class="mobile-tab-btn" data-tab="specs">3. Specs</button>
        </div>

        <div id="tab-art" class="block lg:block">Art Content</div>
        <div id="tab-cutlines" class="hidden lg:block">Cut Content</div>
        <div id="tab-specs" class="hidden lg:block">Specs Content</div>
      </div>

      <div id="payment-details-section">Payment Details</div>
      <button id="mobileStickyCheckoutBtn">Checkout</button>
    `;

    // Reset hash
    window.location.hash = '';

    // Mock scrollIntoView
    Element.prototype.scrollIntoView = jest.fn();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    jest.clearAllMocks();
  });

  test('initializes with art tab active', () => {
    initMobileTabs();

    const artTabBtn = document.querySelector('.mobile-tab-btn[data-tab="art"]');
    const artSection = document.getElementById('tab-art');
    const specsSection = document.getElementById('tab-specs');

    expect(artTabBtn.classList.contains('bg-indigo-600')).toBe(true);
    expect(artSection.classList.contains('hidden')).toBe(false);
    expect(specsSection.classList.contains('hidden')).toBe(true);
  });

  test('switching tabs updates active button and visible section', () => {
    initMobileTabs();

    const specsTabBtn = document.querySelector('.mobile-tab-btn[data-tab="specs"]');
    specsTabBtn.click();

    const artSection = document.getElementById('tab-art');
    const specsSection = document.getElementById('tab-specs');

    expect(specsTabBtn.classList.contains('bg-indigo-600')).toBe(true);
    expect(specsSection.classList.contains('hidden')).toBe(false);
    expect(artSection.classList.contains('hidden')).toBe(true);
  });

  test('clicking Jump to Sticker Editor switches active tab back to art', () => {
    initMobileTabs();

    // First switch to specs
    const specsTabBtn = document.querySelector('.mobile-tab-btn[data-tab="specs"]');
    specsTabBtn.click();
    expect(document.getElementById('tab-art').classList.contains('hidden')).toBe(true);

    // Now click Jump to Sticker Editor
    const jumpBtn = document.getElementById('jump-to-editor-btn');
    jumpBtn.click();

    const artTabBtn = document.querySelector('.mobile-tab-btn[data-tab="art"]');
    const artSection = document.getElementById('tab-art');
    const specsSection = document.getElementById('tab-specs');

    expect(artTabBtn.classList.contains('bg-indigo-600')).toBe(true);
    expect(artSection.classList.contains('hidden')).toBe(false);
    expect(specsSection.classList.contains('hidden')).toBe(true);
  });

  test('hash change to #sticker-design-box selects art tab', () => {
    initMobileTabs();

    // First switch to cutlines
    const cutlinesTabBtn = document.querySelector('.mobile-tab-btn[data-tab="cutlines"]');
    cutlinesTabBtn.click();
    expect(document.getElementById('tab-art').classList.contains('hidden')).toBe(true);

    // Fire hashchange
    window.location.hash = '#sticker-design-box';
    window.dispatchEvent(new HashChangeEvent('hashchange'));

    const artTabBtn = document.querySelector('.mobile-tab-btn[data-tab="art"]');
    const artSection = document.getElementById('tab-art');

    expect(artTabBtn.classList.contains('bg-indigo-600')).toBe(true);
    expect(artSection.classList.contains('hidden')).toBe(false);
  });
});
