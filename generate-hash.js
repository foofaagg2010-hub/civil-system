// generate-hash.js
const crypto = require('crypto');

function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

const password = 'ABDULLAH123';
const hashed = hashPassword(password);

console.log('كلمة المرور:', password);
console.log('التشفير الجديد (SHA256):');
console.log(hashed);
console.log('\nانسخ هذا ونفذه في Supabase:');
console.log(`UPDATE users SET password_hash = '${hashed}' WHERE username = 'ABDULLAH';`);