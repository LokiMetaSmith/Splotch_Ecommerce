// src/mascot.js
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
const mascotContainer = document.getElementById('mascot-container');
const mascotImg = document.getElementById('mascot-img');
const mascotText = document.getElementById('mascot-text');

if (mascotContainer && mascotImg && mascotText) {
    // Random Mascot Selection
    const mascotImages = [
        '/mascot.png',
        '/mascot-1.png',
        '/mascot-2.png',
        '/mascot-3.png',
        '/mascot-4.png',
        '/mascot-5.png',
        '/mascot-6.png',
        '/mascot-7.png'
    ];
    const randomMascot = mascotImages[Math.floor(Math.random() * mascotImages.length)];
    mascotImg.src = randomMascot;

    const messages = [
        "Create something awesome today!",
        "Need some stickers?",
        "I love your design!",
        "Print your imagination!",
        "Splotch is the best!",
        "Don't forget to save!"
    ];

    function updateMascotMessage() {
        const randomMessage = messages[Math.floor(Math.random() * messages.length)];
        mascotText.textContent = randomMessage;
    }

    mascotContainer.addEventListener('mouseenter', updateMascotMessage);
    mascotContainer.addEventListener('focus', updateMascotMessage);

    function triggerMascotAction() {
        updateMascotMessage();
        mascotContainer.classList.remove('wiggle');
        // Visual feedback for click/keyboard activation
        mascotContainer.style.transform = "scale(1.2) rotate(0deg)";
        setTimeout(() => {
            mascotContainer.style.transform = "";
        }, 200);
    }

    mascotContainer.addEventListener('click', triggerMascotAction);
    mascotContainer.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            triggerMascotAction();
        }
    });

    // Wiggle on Proximity
    document.addEventListener('mousemove', (e) => {
        const rect = mascotContainer.getBoundingClientRect();
        const mascotCenterX = rect.left + rect.width / 2;
        const mascotCenterY = rect.top + rect.height / 2;

        const distance = Math.sqrt(
            Math.pow(e.clientX - mascotCenterX, 2) +
            Math.pow(e.clientY - mascotCenterY, 2)
        );

        // Threshold for "near" (e.g., 300 pixels)
        if (distance < 300) {
            mascotContainer.classList.add('wiggle');
        } else {
            mascotContainer.classList.remove('wiggle');
        }
    });

    // Drag and Drop Logic
    mascotContainer.setAttribute('draggable', true);

    mascotContainer.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('application/x-mascot-drag', 'true');
        e.dataTransfer.setData('text/uri-list', mascotImg.src);
        e.dataTransfer.effectAllowed = 'copy';

        // Use the image itself as the drag ghost, not the whole container (bubble etc)
        if (mascotImg) {
            e.dataTransfer.setDragImage(mascotImg, mascotImg.width / 2, mascotImg.height / 2);
        }
    });
}
