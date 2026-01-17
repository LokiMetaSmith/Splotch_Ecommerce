
// a11y-improvements.js
// Handles accessibility enhancements like focus management for skip links

document.addEventListener('DOMContentLoaded', () => {
    // Smooth scroll and focus management for skip link
    const skipLink = document.querySelector('.skip-link');
    if (skipLink) {
        skipLink.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = skipLink.getAttribute('href').substring(1);
            const targetElement = document.getElementById(targetId);
            if (targetElement) {
                targetElement.tabIndex = -1; // Ensure element is focusable
                targetElement.focus({ preventScroll: false }); // Focus the element
                targetElement.scrollIntoView({ behavior: 'smooth' }); // Smooth scroll

                // Remove tabIndex on blur to restore natural order if needed,
                // but usually keeping -1 is fine for container divs.
                targetElement.addEventListener('blur', () => {
                    targetElement.removeAttribute('tabindex');
                }, { once: true });
            }
        });
    }

    // Add keyboard support for interactive elements that might be missing it
    // Example: size buttons are buttons so they work naturally, but let's ensure
    // they have visible focus states (handled in CSS).
});
