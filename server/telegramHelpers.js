import { Markup } from 'telegraf';

export const getOrderStatusKeyboard = (order) => {
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

  return Markup.inlineKeyboard(buttons);
};