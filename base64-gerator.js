const crypto = require('crypto');
const groupKey = crypto.randomBytes(32).toString('base64');
console.log(groupKey);
