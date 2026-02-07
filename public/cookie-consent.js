(function() {
    function setCookie(name, value, days) {
        let expires = "";
        if (days) {
            const date = new Date();
            date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
            expires = "; expires=" + date.toUTCString();
        }
        document.cookie = name + "=" + (value || "") + expires + "; path=/; SameSite=Lax";
    }

    function getCookie(name) {
        const nameEQ = name + "=";
        const ca = document.cookie.split(';');
        for (let i = 0; i < ca.length; i++) {
            let c = ca[i];
            while (c.charAt(0) === ' ') c = c.substring(1, c.length);
            if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length, c.length);
        }
        return null;
    }

    function createBanner() {
        const banner = document.createElement('div');
        banner.id = 'cookie-consent-banner';
        banner.style.position = 'fixed';
        banner.style.bottom = '0';
        banner.style.left = '0';
        banner.style.width = '100%';
        banner.style.backgroundColor = '#2A284D'; // splotch-navy
        banner.style.color = 'white';
        banner.style.padding = '1rem';
        banner.style.textAlign = 'center';
        banner.style.zIndex = '9999';
        banner.style.display = 'flex';
        banner.style.justifyContent = 'center';
        banner.style.alignItems = 'center';
        banner.style.gap = '1rem';
        banner.style.boxShadow = '0 -2px 10px rgba(0,0,0,0.2)';
        banner.style.fontFamily = 'Baumans, sans-serif';

        const text = document.createElement('p');
        text.textContent = 'We use cookies to improve your experience and process orders securely.';
        text.style.margin = '0';
        text.style.fontSize = '0.9rem';

        const button = document.createElement('button');
        button.textContent = 'Accept';
        button.style.backgroundColor = '#FF003A'; // splotch-red
        button.style.color = 'white';
        button.style.border = 'none';
        button.style.padding = '0.5rem 1.5rem';
        button.style.borderRadius = '9999px';
        button.style.cursor = 'pointer';
        button.style.fontWeight = 'bold';
        button.style.transition = 'transform 0.1s, filter 0.1s';

        button.addEventListener('mouseover', () => {
            button.style.filter = 'brightness(1.1)';
        });
        button.addEventListener('mouseout', () => {
            button.style.filter = 'brightness(1.0)';
        });

        button.addEventListener('click', () => {
            setCookie('cookie_consent', 'true', 365);
            banner.remove();
        });

        banner.appendChild(text);
        banner.appendChild(button);
        document.body.appendChild(banner);
    }

    if (!getCookie('cookie_consent')) {
        // Wait for DOM to be ready if it's not already
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', createBanner);
        } else {
            createBanner();
        }
    }
})();
