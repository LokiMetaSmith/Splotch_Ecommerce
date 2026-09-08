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
});
