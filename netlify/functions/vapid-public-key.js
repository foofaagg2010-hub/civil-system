
exports.handler = async (event) => {
    if (event.httpMethod !== 'GET') {
        return {
            statusCode: 405,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }
    
    return {
        statusCode: 200,
        body: JSON.stringify({
            publicKey: process.env.VAPID_PUBLIC_KEY || ''
        })
    };
};