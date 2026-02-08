/**
 * @jest-environment jsdom
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Login Modal Structure', () => {
    let html;

    beforeAll(() => {
        html = fs.readFileSync(path.resolve(__dirname, '../../printshop.html'), 'utf8');
    });

    beforeEach(() => {
        document.documentElement.innerHTML = html;
    });

    test('Login inputs should be wrapped in a form', () => {
        const usernameInput = document.getElementById('username-input');
        const passwordInput = document.getElementById('password-input');
        const form = usernameInput.closest('form');

        expect(form).not.toBeNull();
        expect(form.getAttribute('id')).toBe('login-form');
        expect(form.contains(passwordInput)).toBe(true);
    });

    test('Login button should be type submit', () => {
         const loginBtn = document.getElementById('password-login-btn');
         expect(loginBtn.getAttribute('type')).toBe('submit');
    });

    test('Username input should have autocomplete and required', () => {
        const usernameInput = document.getElementById('username-input');
        expect(usernameInput.getAttribute('autocomplete')).toBe('username');
        expect(usernameInput.hasAttribute('required')).toBe(true);
    });

    test('Password input should have autocomplete and required', () => {
        const passwordInput = document.getElementById('password-input');
        expect(passwordInput.getAttribute('autocomplete')).toBe('current-password');
        expect(passwordInput.hasAttribute('required')).toBe(true);
    });
});
