const jwt = require('jsonwebtoken');

const token = jwt.sign({ email: 'test@example.com', isGuest: true }, 'secret');
console.log(token);
