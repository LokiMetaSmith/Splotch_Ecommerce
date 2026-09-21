import { jest } from '@jest/globals';

jest.unstable_mockModule('child_process', () => ({
    execFile: jest.fn((file, args, callback) => {
        if (file === 'which' && args[0] === 'openrgb') {
            callback(null, '/usr/bin/openrgb\n', '');
        } else if (file === 'openrgb') {
            callback(null, 'OK', '');
        } else if (file === 'sync') {
            callback(null, '', '');
        } else {
            callback(new Error('Unknown command'), '', '');
        }
    })
}));

describe('Hardware Utility Security & Execution Tests', () => {
    let childProcess;
    let hardware;

    beforeEach(async () => {
        jest.resetModules();
        jest.clearAllMocks();
        childProcess = await import('child_process');
        hardware = await import('../utils/hardware.js');
    });

    test('flushUsbDrive uses execFile with arguments array', async () => {
        const testMountPoint = '/media/auto_mount_usb; echo hacked';
        await hardware.flushUsbDrive(testMountPoint);

        expect(childProcess.execFile).toHaveBeenCalledWith(
            'sync',
            ['-f', testMountPoint],
            expect.any(Function)
        );
    });

    test('setRgbState calls execFile with openrgb arguments array', async () => {
        await hardware.setRgbState('idle');

        expect(childProcess.execFile).toHaveBeenCalledWith(
            'openrgb',
            ['--cli', '--mode', 'direct', '--color', '00FF00'],
            expect.any(Function)
        );
    });

    test('checks OpenRGB availability on first call', async () => {
        await hardware.setRgbState('idle');

        // Should check availability via "which openrgb"
        expect(childProcess.execFile).toHaveBeenCalledWith(
            'which',
            ['openrgb'],
            expect.any(Function)
        );
    });

    test('caches OpenRGB availability to prevent multiple checks', async () => {
        await hardware.setRgbState('idle');

        const callCount = childProcess.execFile.mock.calls.filter(call => call[0] === 'which').length;
        expect(callCount).toBe(1);

        await hardware.setRgbState('writing');

        const callCountAfterSecond = childProcess.execFile.mock.calls.filter(call => call[0] === 'which').length;
        expect(callCountAfterSecond).toBe(1);
    });

    test('gracefully handles when OpenRGB is not installed', async () => {
        // Temporarily override the mock to fail the `which openrgb` check
        childProcess.execFile.mockImplementation((file, args, callback) => {
            if (file === 'which' && args[0] === 'openrgb') {
                callback(new Error('Command failed'), '', '');
            } else if (file === 'sync') {
                callback(null, '', '');
            } else {
                callback(new Error('Unknown command'), '', '');
            }
        });

        await hardware.setRgbState('idle');

        // It should still check for availability
        expect(childProcess.execFile).toHaveBeenCalledWith(
            'which',
            ['openrgb'],
            expect.any(Function)
        );

        // It should NOT call openrgb cli to set color since it's unavailable
        const openRgbCalls = childProcess.execFile.mock.calls.filter(call => call[0] === 'openrgb');
        expect(openRgbCalls.length).toBe(0);

        // Second call should also be graceful and not trigger another which check
        await hardware.setRgbState('writing');
        const whichCalls = childProcess.execFile.mock.calls.filter(call => call[0] === 'which');
        expect(whichCalls.length).toBe(1); // Cached as unavailable
    });
});
