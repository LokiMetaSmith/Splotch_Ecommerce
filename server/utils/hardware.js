import { exec } from 'child_process';

let isOpenRgbAvailable = null;

/**
 * Helper function to execute a shell command wrapped in a Promise.
 */
const executeCommand = (command) => {
    return new Promise((resolve, reject) => {
        exec(command, (error, stdout, stderr) => {
            if (error) {
                return reject(error);
            }
            resolve(stdout ? stdout.trim() : stderr.trim());
        });
    });
};

/**
 * Checks if OpenRGB is installed on the host system.
 * This ensures the integration is fully modular and won't crash 
 * or spam logs if running on a standard VPS or developer laptop.
 */
const checkOpenRgb = async () => {
    if (isOpenRgbAvailable !== null) return isOpenRgbAvailable;
    
    try {
        await executeCommand('which openrgb');
        isOpenRgbAvailable = true;
        console.log('[Hardware] OpenRGB detected. Chassis lighting integration enabled.');
    } catch (err) {
        isOpenRgbAvailable = false;
        console.log('[Hardware] OpenRGB not found. Running in standard software-only mode.');
    }
    return isOpenRgbAvailable;
};

/**
 * Changes the GMKtec Chassis RGB lighting based on the application state.
 * @param {string} state - 'idle', 'writing', 'incoming', or 'error'
 */
const setRgbState = async (state) => {
    const isAvailable = await checkOpenRgb();
    if (!isAvailable) return; // Fail gracefully if not on the physical drop box

    let color = '';
    let mode = 'direct';

    switch(state) {
        case 'idle':
        case 'safe':
            color = '00FF00'; // Solid Green
            mode = 'direct';
            break;
        case 'writing':
            color = 'FF0000'; // Blinking Red (or breathing)
            mode = 'breathing';
            break;
        case 'incoming':
            color = 'A020F0'; // Purple
            mode = 'direct';
            break;
        case 'error':
            color = 'FFFF00'; // Flashing Yellow
            mode = 'breathing';
            break;
        default:
            console.warn(`[Hardware] Unknown RGB state requested: ${state}`);
            return;
    }

    try {
        // NOTE: On some systems, setting mode and color requires passing the specific device (-d 0)
        // openrgb --cli --mode <mode> --color <color>
        await executeCommand(`openrgb --cli --mode ${mode} --color ${color}`);
    } catch (err) {
        console.warn(`[Hardware] OpenRGB command failed: ${err.message}`);
        // We do not disable isOpenRgbAvailable here because the daemon might just be restarting
    }
};

/**
 * Forces the OS to flush all filesystem buffers to the physical USB stick.
 * MUST be called before turning the LED green.
 */
const flushUsbDrive = async (mountPoint = '/media/auto_mount_usb') => {
    try {
        console.log('[Hardware] Flushing data buffers to physical USB storage...');
        // 'sync -f' forces a sync of the filesystem containing the file/directory
        await executeCommand(`sync -f ${mountPoint}`);
        console.log('[Hardware] USB flush complete. Safe to remove.');
    } catch (err) {
        // If it fails (e.g. standard macOS/Windows dev environment without sync -f support)
        // fallback to standard global sync
        try {
            await executeCommand('sync');
            console.log('[Hardware] Global sync complete.');
        } catch (fallbackErr) {
            console.warn(`[Hardware] Failed to sync filesystem buffers: ${fallbackErr.message}`);
        }
    }
};

export {
    setRgbState,
    flushUsbDrive
};
