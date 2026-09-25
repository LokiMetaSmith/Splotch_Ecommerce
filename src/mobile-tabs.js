export function switchTab(tabId) {
  const tabs = document.querySelectorAll(".mobile-tab-btn");
  const sections = {
    art: document.getElementById("tab-art"),
    cutlines: document.getElementById("tab-cutlines"),
    specs: document.getElementById("tab-specs"),
  };

  Object.values(sections).forEach((section) => {
    if (section) {
      section.classList.add("hidden", "lg:block");
    }
  });

  tabs.forEach((t) => {
    t.classList.remove("bg-white", "text-indigo-700", "shadow-sm");
    t.classList.add("text-gray-600", "hover:text-gray-900");
  });

  if (sections[tabId]) {
    sections[tabId].classList.remove("hidden");
  }

  const activeTab = document.querySelector(
    `.mobile-tab-btn[data-tab="${tabId}"]`,
  );
  if (activeTab) {
    activeTab.classList.remove("text-gray-600", "hover:text-gray-900");
    activeTab.classList.add("bg-white", "text-indigo-700", "shadow-sm");
  }
}

export function setupJumpToEditor() {
  const jumpLinks = document.querySelectorAll('a[href="#sticker-design-box"]');
  jumpLinks.forEach((link) => {
    link.addEventListener("click", () => {
      const artTabBtn = document.querySelector(
        '.mobile-tab-btn[data-tab="art"]',
      );
      if (artTabBtn) {
        artTabBtn.click();
      } else {
        switchTab("art");
      }
    });
  });

  const checkHash = () => {
    if (
      typeof window !== "undefined" &&
      window.location &&
      window.location.hash === "#sticker-design-box"
    ) {
      const artTabBtn = document.querySelector(
        '.mobile-tab-btn[data-tab="art"]',
      );
      if (artTabBtn) {
        artTabBtn.click();
      } else {
        switchTab("art");
      }
    }
  };

  if (typeof window !== "undefined") {
    window.addEventListener("hashchange", checkHash);
    checkHash();
  }
}

export function initMobileTabs() {
  const tabs = document.querySelectorAll(".mobile-tab-btn");
  if (tabs.length === 0) return;

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const tabId = tab.getAttribute("data-tab");
      switchTab(tabId);
    });
  });

  switchTab("art");
  setupJumpToEditor();
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initMobileTabs);
  } else {
    initMobileTabs();
  }
}

// Setup Mobile Sticky Bar Checkout button
if (typeof document !== "undefined") {
  const setupStickyCheckout = () => {
    const stickyCheckoutBtn = document.getElementById(
      "mobileStickyCheckoutBtn",
    );
    if (stickyCheckoutBtn) {
      stickyCheckoutBtn.addEventListener("click", () => {
        // Switch to specs tab
        const specsTabBtn = document.querySelector(
          '.mobile-tab-btn[data-tab="specs"]',
        );
        if (specsTabBtn) {
          specsTabBtn.click();
        } else {
          switchTab("specs");
        }

        // Scroll to payment form
        const paymentForm = document.getElementById("payment-details-section");
        if (paymentForm) {
          paymentForm.scrollIntoView({ behavior: "smooth" });
        }
      });
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setupStickyCheckout);
  } else {
    setupStickyCheckout();
  }
}
