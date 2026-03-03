
// src/notifications.js

/**
 * Creates a toast notification manager.
 */
class ToastManager {
  constructor() {
    this.container = null;
  }

  getContainer() {
    if (!this.container) {
      this.container = document.createElement("div");
      this.container.id = "toast-container";
      this.container.className =
        "fixed top-24 right-4 z-[10000] flex flex-col gap-2 pointer-events-none";
      document.body.appendChild(this.container);
    }
    return this.container;
  }

  show(message, type = "info", duration = 4000) {
    const container = this.getContainer();
    const toast = document.createElement("div");

    // Base styles
    const baseClasses = [
      "pointer-events-auto",
      "flex",
      "items-center",
      "w-full",
      "max-w-xs",
      "p-4",
      "mb-2",
      "text-gray-500",
      "bg-white",
      "rounded-lg",
      "shadow-lg",
      "border-l-4",
      "transform",
      "transition-all",
      "duration-300",
      "ease-in-out",
      "translate-x-full", // Start off-screen
      "opacity-0"
    ];

    // Type-specific styles
    let typeClasses = [];
    let icon = "";
    let role = "status";

    switch (type) {
      case "success":
        typeClasses = ["border-splotch-teal", "text-gray-800"];
        icon = `
          <div class="inline-flex items-center justify-center flex-shrink-0 w-8 h-8 text-green-500 bg-green-100 rounded-lg">
            <svg class="w-5 h-5" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 20 20">
                <path d="M10 .5a9.5 9.5 0 1 0 9.5 9.5A9.51 9.51 0 0 0 10 .5Zm3.707 8.207-4 4a1 1 0 0 1-1.414 0l-2-2a1 1 0 0 1 1.414-1.414L9 10.586l3.293-3.293a1 1 0 0 1 1.414 1.414Z"/>
            </svg>
            <span class="sr-only">Check icon</span>
          </div>`;
        role = "status";
        break;
      case "error":
        typeClasses = ["border-splotch-red", "text-gray-800"];
        icon = `
          <div class="inline-flex items-center justify-center flex-shrink-0 w-8 h-8 text-red-500 bg-red-100 rounded-lg">
            <svg class="w-5 h-5" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 20 20">
                <path d="M10 .5a9.5 9.5 0 1 0 9.5 9.5A9.51 9.51 0 0 0 10 .5Zm3.707 11.793a1 1 0 1 1-1.414 1.414L10 11.414l-2.293 2.293a1 1 0 0 1-1.414-1.414L8.586 10 6.293 7.707a1 1 0 0 1 1.414-1.414L10 8.586l2.293-2.293a1 1 0 0 1 1.414 1.414L11.414 10l2.293 2.293Z"/>
            </svg>
            <span class="sr-only">Error icon</span>
          </div>`;
        role = "alert";
        break;
      case "info":
      default:
        typeClasses = ["border-splotch-navy", "text-gray-800"];
        icon = `
          <div class="inline-flex items-center justify-center flex-shrink-0 w-8 h-8 text-blue-500 bg-blue-100 rounded-lg">
            <svg class="w-5 h-5" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 20 20">
                <path d="M10 .5a9.5 9.5 0 1 0 9.5 9.5A9.51 9.51 0 0 0 10 .5ZM10 15a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm1-4a1 1 0 0 1-2 0V6a1 1 0 0 1 2 0v5Z"/>
            </svg>
            <span class="sr-only">Info icon</span>
          </div>`;
        role = "status";
        break;
    }

    toast.className = [...baseClasses, ...typeClasses].join(" ");
    toast.setAttribute("role", role);

    // Content structure
    toast.innerHTML = `
      ${icon}
      <div class="ml-3 text-sm font-normal message-content" style="font-family: var(--font-baumans)"></div>
      <button type="button" class="ml-auto -mx-1.5 -my-1.5 bg-white text-gray-400 hover:text-gray-900 rounded-lg focus:ring-2 focus:ring-gray-300 p-1.5 hover:bg-gray-100 inline-flex items-center justify-center h-8 w-8" aria-label="Close">
        <svg class="w-3 h-3" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 14 14">
            <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m1 1 6 6m0 0 6 6M7 7l6-6M7 7l-6 6"/>
        </svg>
      </button>
    `;

    // Safely set text content
    toast.querySelector('.message-content').textContent = message;

    // Add close button listener
    const closeBtn = toast.querySelector("button");
    closeBtn.addEventListener("click", () => {
        this.dismiss(toast);
    });

    container.appendChild(toast);

    // Animate in
    requestAnimationFrame(() => {
        toast.classList.remove("translate-x-full", "opacity-0");
    });

    // Auto dismiss
    if (duration > 0) {
      setTimeout(() => {
        this.dismiss(toast);
      }, duration);
    }
  }

  dismiss(toast) {
      if (!toast) return;
      // Animate out
      toast.classList.add("translate-x-full", "opacity-0");

      // Remove from DOM after animation
      toast.addEventListener("transitionend", () => {
          if (toast.parentNode) {
              toast.parentNode.removeChild(toast);
          }
      }, { once: true });
  }
}

const toastManager = new ToastManager();

export function showNotification(message, type = "info", duration = 4000) {
  toastManager.show(message, type, duration);
}
