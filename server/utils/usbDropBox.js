import fs from 'fs';
import path from 'path';
import * as hardware from './hardware.js';

// Configuration
const DROPBOX_MOUNT_POINT = '/media/auto_mount_usb';
const ENABLE_DROPBOX = process.env.ENABLE_USB_DROPBOX === 'true' || true; // Can be toggled in .env, default true for SBCs

/**
 * Handles saving order assets to the physical USB drop box and orchestrating the RGB indicators.
 * Fails gracefully if the USB drive is not mounted or OpenRGB is not available.
 * 
 * @param {Object} order - The newly created order object
 * @param {Object} storageProvider - The storage provider to fetch files
 */
const processIncomingOrderToDropBox = async (order, storageProvider) => {
    if (!ENABLE_DROPBOX) return;

    try {
        // Check if the drop box directory exists (meaning a USB is plugged in and auto-mounted)
        if (!fs.existsSync(DROPBOX_MOUNT_POINT)) {
            console.log(`[DropBox] USB mount point not found at ${DROPBOX_MOUNT_POINT}. Skipping drop box export.`);
            return;
        }

        // 1. Order Incoming - Flash Purple
        await hardware.setRgbState('incoming');

        // Allow the light to flash purple for a second before changing state
        await new Promise(resolve => setTimeout(resolve, 1000));

        // 2. Start Writing - Blink Red
        await hardware.setRgbState('writing');

        // Create an order-specific folder on the USB stick
        const orderDir = path.join(DROPBOX_MOUNT_POINT, `Order_${order.orderId}`);
        if (!fs.existsSync(orderDir)) {
            fs.mkdirSync(orderDir, { recursive: true });
        }

        console.log(`[DropBox] Writing assets for order ${order.orderId} to USB...`);

        // Helper to copy a file from storage to the USB
        const copyToUsb = async (assetPath, newFileName) => {
            if (!assetPath) return;
            try {
                // Gets the absolute path of the local file from the storage provider
                const localPath = await storageProvider.getLocalCopy(assetPath);
                if (fs.existsSync(localPath)) {
                    const destination = path.join(orderDir, newFileName);
                    fs.copyFileSync(localPath, destination);
                }
            } catch (err) {
                console.warn(`[DropBox] Failed to copy asset ${assetPath}:`, err.message);
            }
        };

        // Copy the main design image
        if (order.designImagePath) {
            const ext = path.extname(order.designImagePath) || '.png';
            await copyToUsb(order.designImagePath, `design${ext}`);
        }

        // Copy the cutline if available
        if (order.orderDetails && order.orderDetails.cutLinePath) {
            const ext = path.extname(order.orderDetails.cutLinePath) || '.svg';
            await copyToUsb(order.orderDetails.cutLinePath, `cutline${ext}`);
        }

        // Save a JSON summary of the order for the printing PC
        const summary = {
            orderId: order.orderId,
            timestamp: order.timestamp,
            quantity: order.orderDetails.quantity || 1,
            material: order.orderDetails.material || 'pp_standard',
            promoAddon: order.orderDetails.promoAddon || false,
            shippingContact: order.shippingContact
        };
        fs.writeFileSync(path.join(orderDir, 'order_summary.json'), JSON.stringify(summary, null, 2));

        // 3. Flush buffers to physical stick
        await hardware.flushUsbDrive(DROPBOX_MOUNT_POINT);

        // 4. Safe to Remove - Solid Green
        await hardware.setRgbState('safe');
        console.log(`[DropBox] Successfully processed order ${order.orderId}. Safe to remove USB.`);

    } catch (err) {
        console.error(`[DropBox] Error processing order ${order.orderId}:`, err);
        // Flashing Yellow for error state
        await hardware.setRgbState('error');
    }
};

export {
    processIncomingOrderToDropBox
};
