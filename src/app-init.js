// src/app-init.js

// Service Worker Registration
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').then(registration => {
            console.log('ServiceWorker registration successful with scope: ', registration.scope);
        }, err => {
            console.log('ServiceWorker registration failed: ', err);
        });
    });
}

// Mascot Interaction
document.addEventListener('DOMContentLoaded', () => {
    const mascotContainer = document.getElementById('mascot-container');
    const mascotText = document.getElementById('mascot-text');
    if (!mascotContainer || !mascotText) return;

    const messages = [
        "Create something awesome today!",
        "Need some stickers?",
        "I love your design!",
        "Print your imagination!",
        "Splotch is the best!",
        "Don't forget to save!"
    ];

    mascotContainer.addEventListener('mouseenter', () => {
        const randomMessage = messages[Math.floor(Math.random() * messages.length)];
        mascotText.textContent = randomMessage;
    });
});
