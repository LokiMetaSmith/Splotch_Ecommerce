from playwright.sync_api import sync_playwright, expect

def run_verification(playwright):
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page()

    try:
        # Verify index.html
        print("Navigating to index.html...")
        page.goto("http://localhost:5173/index.html", timeout=60000)

        print("Waiting for canvas to be visible...")
        canvas = page.locator("#imageCanvas")
        expect(canvas).to_be_visible(timeout=30000)

        print("Taking screenshot of index.html after refactor...")
        page.screenshot(path="index_refactor.png")
        print("Screenshot of index.html taken.")

        # Verify orders.html
        print("Navigating to orders.html...")
        page.goto("http://localhost:5173/orders.html", timeout=60000)

        print("Waiting for heading to be visible...")
        heading = page.get_by_role("heading", name="Your Order History")
        expect(heading).to_be_visible(timeout=30000)

        print("Taking screenshot of orders.html after refactor...")
        page.screenshot(path="orders_refactor.png")
        print("Screenshot of orders.html taken.")

    except Exception as e:
        print(f"An error occurred: {e}")
    finally:
        browser.close()

with sync_playwright() as playwright:
    run_verification(playwright)
