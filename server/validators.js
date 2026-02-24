import { body, param, query } from 'express-validator';

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
// Kept for backward compatibility, but validateId now enforces UUID
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
    .trim()
    .isLength({ min: 3, max: 30 }).withMessage('Username must be between 3 and 30 characters')
    .matches(/^[a-zA-Z0-9_-]+$/).withMessage('Username can only contain letters, numbers, underscores, and hyphens')
    .custom(value => {
      if (sanitizeUsername(value) === null) {
        throw new Error('Invalid username');
      }
      return true;
    }),
];

// Reusable username validation middleware for query params
export const validateUsernameQuery = [
  query('username')
    .notEmpty().withMessage('Username is required')
    .isString().withMessage('Username must be a string')
    .trim()
    .isLength({ min: 3, max: 30 }).withMessage('Username must be between 3 and 30 characters')
    .matches(/^[a-zA-Z0-9_-]+$/).withMessage('Username can only contain letters, numbers, underscores, and hyphens')
    .custom(value => {
      if (sanitizeUsername(value) === null) {
        throw new Error('Invalid username');
      }
      return true;
    }),
];

// Reusable ID validation middleware for route parameters
// Updated: Now enforces UUID format for stricter security
export const validateId = (paramName) => [
    param(paramName)
        .isUUID().withMessage('Invalid ID format. Must be a valid UUID.')
];
