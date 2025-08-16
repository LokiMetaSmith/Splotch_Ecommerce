from playwright.sync_api import sync_playwright, expect

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        
        # Navigate to the status page
        page.goto("http://localhost:5173/status.html")
        
        # Wait for the animation container to be visible
        inky_animation = page.locator("#inky-animation")
        expect(inky_animation).to_be_visible()
        
        # Give the animation a moment to start
        page.wait_for_timeout(1000)
        
        # Take a screenshot
        page.screenshot(path="jules-scratch/verification/verification.png")
        
        browser.close()

if __name__ == "__main__":
    run()
