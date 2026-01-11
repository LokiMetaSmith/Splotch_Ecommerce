import { body, param } from 'express-validator';

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

// Check if an ID is valid (not a prototype key)
export const isValidId = (id) => {
    if (typeof id !== 'string') return false;
    const forbiddenKeys = ['__proto__', 'constructor', 'prototype'];
    return !forbiddenKeys.includes(id.toLowerCase());
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

// Reusable ID validation middleware for route parameters
export const validateId = (paramName) => [
    param(paramName)
        .custom((value) => {
            if (!isValidId(value)) {
                throw new Error('Invalid ID');
            }
            return true;
        })
];
