from playwright.sync_api import sync_playwright

def run(playwright):
    browser = playwright.chromium.launch()
    page = browser.new_page()

    # Capture console logs
    page.on("console", lambda msg: print(f"PAGE LOG: {msg.text}"))

    # Navigate to the dummy orders page
    page.goto("http://localhost:5173/jules-scratch/orders.html")

    # Click the reorder link
    page.click("#reorder-link")

    # Wait for the main page to load and the canvas to be updated
    page.wait_for_selector("#imageCanvas")

    # Give the image time to load
    page.wait_for_timeout(2000)

    # Take a screenshot
    page.screenshot(path="jules-scratch/verification/verification.png")

    browser.close()

with sync_playwright() as playwright:
    run(playwright)
