export function initMobileTabs() {
  const tabs = document.querySelectorAll(".mobile-tab-btn");
  const sections = {
    art: document.getElementById("tab-art"),
    cutlines: document.getElementById("tab-cutlines"),
    specs: document.getElementById("tab-specs"),
  };

  if (tabs.length === 0) return;

  function switchTab(tabId) {
    Object.values(sections).forEach((section) => {
      if (section) {
        section.classList.add("hidden", "lg:block");
      }
    });

    tabs.forEach((t) => {
      t.classList.remove("bg-indigo-600", "text-white");
      t.classList.add("bg-white", "text-gray-600", "hover:bg-gray-50");
    });

    if (sections[tabId]) {
      sections[tabId].classList.remove("hidden");
    }

    const activeTab = document.querySelector(
      `.mobile-tab-btn[data-tab="${tabId}"]`,
    );
    if (activeTab) {
      activeTab.classList.remove(
        "bg-white",
        "text-gray-600",
        "hover:bg-gray-50",
      );
      activeTab.classList.add("bg-indigo-600", "text-white");
    }
  }

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const tabId = tab.getAttribute("data-tab");
      switchTab(tabId);
    });
  });

  switchTab("art");
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", initMobileTabs);
}

// Setup Mobile Sticky Bar Checkout button
if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
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
        }

        // Scroll to payment form
        const paymentForm = document.getElementById("payment-details-section");
        if (paymentForm) {
          paymentForm.scrollIntoView({ behavior: "smooth" });
        }
      });
    }
  });
}
