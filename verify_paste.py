from playwright.sync_api import sync_playwright

def verify_paste_context_menu():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            # Navigate to the app
            page.goto("http://localhost:5173")

            # Wait for the placeholder
            placeholder = page.locator("#canvas-placeholder")
            placeholder.wait_for(state="visible")

            # Verify contenteditable attribute is not "false"
            # It should be inherited from parent (which is "true")
            # We can check isContentEditable property
            is_editable = placeholder.evaluate("el => el.isContentEditable")
            print(f"isContentEditable: {is_editable}")

            if not is_editable:
                print("FAILED: Placeholder is not contenteditable.")
                raise Exception("Placeholder is not contenteditable")

            # Take a screenshot
            page.screenshot(path="verification_paste.png")
            print("Screenshot saved to verification_paste.png")

        except Exception as e:
            print(f"Error: {e}")
            raise e
        finally:
            browser.close()

if __name__ == "__main__":
    verify_paste_context_menu()
