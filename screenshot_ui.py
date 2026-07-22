import asyncio
from playwright.async_api import async_playwright
import time

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(ignore_https_errors=True)
        # Try a few times in case the server takes a moment
        for _ in range(10):
            try:
                await page.goto('http://127.0.0.1:38075')
                break
            except Exception:
                await asyncio.sleep(1)

        # Click upload file to show cutline options
        await page.locator('#file').set_input_files('public/mascot.png')

        # Wait a bit for processing
        await asyncio.sleep(10)

        # Take full screenshot
        await page.screenshot(path='full_page3.png', full_page=True)
        await browser.close()

asyncio.run(main())
