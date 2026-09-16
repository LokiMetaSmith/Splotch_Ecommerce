import { Markup } from 'telegraf';
import { getSecret } from './secretManager.js';

export const getOrderJobUrl = (order, baseUrl) => {
  if (!order || !order.orderId) return '';
  const domain = (baseUrl || getSecret('BASE_URL') || process.env.BASE_URL || 'https://www.splotch.page').replace(/\/+$/, '');
  return `${domain}/printshop.html?orderId=${encodeURIComponent(order.orderId)}`;
};

export const formatOrderPrintDetails = (order, baseUrl) => {
  const details = order?.orderDetails || {};
  const lines = [];

  // Resolution
  let resStr = '300 DPI';
  if (details.resolution) {
    if (typeof details.resolution === 'string' && details.resolution.startsWith('dpi_')) {
      resStr = `${details.resolution.replace('dpi_', '')} DPI`;
    } else {
      resStr = `${details.resolution}`;
    }
  }

  // Size
  let sizeStr = '';
  if (details.size) {
    sizeStr = details.size;
  } else if (details.widthInches && details.heightInches) {
    sizeStr = `${details.widthInches}" × ${details.heightInches}"`;
  } else if (details.dimensions && details.dimensions.width && details.dimensions.height) {
    const ppi = typeof details.resolution === 'string' && details.resolution.includes('600') ? 600 : (details.resolution?.includes('1200') ? 1200 : 300);
    const w = (Number(details.dimensions.width) / ppi).toFixed(1);
    const h = (Number(details.dimensions.height) / ppi).toFixed(1);
    sizeStr = `${w}" × ${h}"`;
  } else if (order?.packageAreaSqIn) {
    sizeStr = `~${order.packageAreaSqIn} sq in`;
  }

  // Material
  let matStr = details.material || 'Standard';
  const matMap = {
    pp_standard: 'Standard Polypropylene',
    pp_clear: 'Clear Polypropylene',
    pp_holographic: 'Holographic',
    pp_glitter: 'Glitter',
    vinyl: 'Vinyl',
  };
  if (matMap[matStr]) {
    matStr = matMap[matStr];
  }

  lines.push('--- Print Settings ---');
  if (sizeStr) lines.push(`📐 Size: ${sizeStr}`);
  lines.push(`🖨 Resolution: ${resStr}`);
  lines.push(`🏷 Material: ${matStr}`);
  if (details.cutType) {
    const cut = details.cutType === 'kiss_cut' ? 'Kiss Cut' : 'Die Cut';
    lines.push(`✂️ Cut: ${cut}`);
  }
  if (details.customLayers && details.customLayers.length > 0) {
    lines.push(`📑 Layers: ${details.customLayers.length}`);
  }

  const jobUrl = getOrderJobUrl(order, baseUrl);
  if (jobUrl) {
    lines.push(`🔗 Job Link: ${jobUrl}`);
  }

  return lines.join('\n');
};

export const getOrderStatusKeyboard = (order, baseUrl) => {
  const buttons = [];
  const isPickup = order.deliveryMethod === 'pickup';
  switch (order.status) {
    case 'NEW':
      buttons.push(Markup.button.callback('Accept Order', `accept_${order.orderId}`));
      break;
    case 'ACCEPTED':
      buttons.push(Markup.button.callback('Start Printing', `print_${order.orderId}`));
      break;
    case 'PRINTING':
      if (isPickup) {
        buttons.push(Markup.button.callback('Ready for Pickup', `hold_${order.orderId}`));
      } else {
        buttons.push(Markup.button.callback('Mark as Shipped', `ship_${order.orderId}`));
      }
      break;
    case 'HOLD_FOR_PICKUP':
      buttons.push(Markup.button.callback('Picked Up (Complete)', `complete_${order.orderId}`));
      break;
    case 'SHIPPED':
      buttons.push(Markup.button.callback('Mark as Delivered', `deliver_${order.orderId}`));
      break;
    case 'DELIVERED':
      buttons.push(Markup.button.callback('Complete Order', `complete_${order.orderId}`));
      break;
  }
  // Add a cancel button for all active statuses
  if (order.status !== 'CANCELED' && order.status !== 'COMPLETED') {
    buttons.push(Markup.button.callback('Cancel Order', `cancel_${order.orderId}`));
  }

  const rows = [];
  if (buttons.length > 0) {
    rows.push(buttons);
  }

  const jobUrl = getOrderJobUrl(order, baseUrl);
  if (jobUrl) {
    rows.push([Markup.button.url('🔗 Open in Printshop', jobUrl)]);
  }

  return Markup.inlineKeyboard(rows);
};