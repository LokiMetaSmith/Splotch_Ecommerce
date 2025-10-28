import { body } from 'express-validator';

// Basic username sanitization to prevent prototype pollution
const sanitizeUsername = (username) => {
  if (typeof username !== 'string') {
    return null;
  }
  const forbiddenKeys = ['__proto__', 'constructor', 'prototype'];
  if (forbiddenKeys.includes(username.toLowerCase())) {
    return null;
  }
  return username;
};

// Reusable username validation middleware
export const validateUsername = [
  body('username')
    .notEmpty().withMessage('Username is required')
    .isString().withMessage('Username must be a string')
    .custom(value => {
      if (sanitizeUsername(value) === null) {
        throw new Error('Invalid username');
      }
      return true;
    }),
];
