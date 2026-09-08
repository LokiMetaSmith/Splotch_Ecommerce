// Clean up any registered service workers or legacy caches to prevent caching and storage errors
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then(function (registrations) {
    for (let registration of registrations) {
      registration.unregister().catch(() => {});
    }
  }).catch(() => {});
}
if ("caches" in window) {
  caches.keys().then(function (keys) {
    keys.forEach(function (key) {
      caches.delete(key).catch(() => {});
    });
  }).catch(() => {});
}

// Mascot Interaction
const mascotContainer = document.getElementById("mascot-container");
const mascotImg = document.getElementById("mascot-img");
const mascotText = document.getElementById("mascot-text");

if (mascotContainer && mascotImg && mascotText) {
  const defaultMascot = "/mascot.png";

  // Resilient fallback if any mascot image fails to load
  const handleImageError = () => {
    if (!mascotImg.src.endsWith(defaultMascot)) {
      console.warn("Mascot image failed to load, falling back to default:", defaultMascot);
      mascotImg.src = defaultMascot;
    }
  };
  mascotImg.addEventListener("error", handleImageError);
  if (mascotImg.complete && mascotImg.naturalWidth === 0) {
    handleImageError();
  }

  // Random Mascot Selection
  const mascotImages = [
    "/mascot.png",
    "/mascot-1.png",
    "/mascot-2.png",
    "/mascot-3.png",
    "/mascot-4.png",
    "/mascot-5.png",
    "/mascot-6.png",
    "/mascot-7.png",
  ];
  const randomMascot =
    mascotImages[Math.floor(Math.random() * mascotImages.length)];
  mascotImg.src = randomMascot;

  const messages = [
    "Drag me to the canvas!",
    "Create something awesome today!",
    "Need some stickers?",
    "I love your design!",
    "Print your imagination!",
    "Splotch is the best!",
    "Don't forget to save!",
  ];

  let clickCount = 0;

  function updateMascotMessage() {
    const randomMessage = messages[Math.floor(Math.random() * messages.length)];
    mascotText.textContent = randomMessage;
  }

  mascotContainer.addEventListener("mouseenter", updateMascotMessage);
  mascotContainer.addEventListener("focus", updateMascotMessage);

  function triggerMascotAction() {
    updateMascotMessage();

    clickCount++;
    if (clickCount === 5) {
      document.dispatchEvent(new CustomEvent("easterEggUnlocked"));
    }

    mascotContainer.classList.remove("wiggle");
    // Visual feedback for click/keyboard activation: snappy peel pop
    mascotContainer.style.transform = "scale(1.28) rotate(-16deg) translateY(-16px)";
    setTimeout(() => {
      mascotContainer.style.transform = "";
    }, 180);
  }

  mascotContainer.addEventListener("click", triggerMascotAction);
  mascotContainer.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      triggerMascotAction();
    }
  });

  // Wiggle on Proximity
  document.addEventListener("mousemove", (e) => {
    const rect = mascotContainer.getBoundingClientRect();
    const mascotCenterX = rect.left + rect.width / 2;
    const mascotCenterY = rect.top + rect.height / 2;

    const distance = Math.sqrt(
      Math.pow(e.clientX - mascotCenterX, 2) +
        Math.pow(e.clientY - mascotCenterY, 2),
    );

    // Threshold for "near" (e.g., 300 pixels)
    if (distance < 300) {
      mascotContainer.classList.add("wiggle");
    } else {
      mascotContainer.classList.remove("wiggle");
    }
  });

  document.addEventListener("mouseleave", () => {
    mascotContainer.classList.remove("wiggle");
  });

  // Drag and Drop Logic
  mascotContainer.setAttribute("draggable", true);

  mascotContainer.addEventListener("dragstart", (e) => {
    e.dataTransfer.setData("application/x-mascot-drag", "true");
    e.dataTransfer.setData("text/uri-list", mascotImg.src);
    e.dataTransfer.effectAllowed = "copy";

    // Use the image itself as the drag ghost, not the whole container (bubble etc)
    if (mascotImg) {
      e.dataTransfer.setDragImage(
        mascotImg,
        mascotImg.width / 2,
        mascotImg.height / 2,
      );
    }
  });
}
