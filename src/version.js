document.addEventListener('DOMContentLoaded', () => {
    const versionElements = document.querySelectorAll('.app-version-display');
    versionElements.forEach(el => {
        el.textContent = __APP_VERSION__;
    });
});
