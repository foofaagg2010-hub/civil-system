const buckets = new Map();

function getClientIp(event) {
    const fwd = event.headers['x-forwarded-for'];
    if (fwd) return String(fwd).split(',')[0].trim();
    return event.headers['client-ip'] || event.headers['x-real-ip'] || 'unknown';
}

function checkRateLimit(event, options = {}) {
    const limit = options.limit || 120;
    const windowMs = options.windowMs || 60000;
    const now = Date.now();
    const ip = getClientIp(event);
    const key = `${ip}:${event.httpMethod || 'unknown'}`;

    let bucket = buckets.get(key);
    if (!bucket) {
        bucket = { times: [], limit, windowMs };
        buckets.set(key, bucket);
    }

    bucket.times = bucket.times.filter((t) => now - t < bucket.windowMs);

    if (bucket.times.length >= bucket.limit) {
        const retryAfter = Math.max(1, Math.ceil((bucket.times[0] + bucket.windowMs - now) / 1000));
        return { limited: true, retryAfter };
    }

    bucket.times.push(now);

    if (Math.random() < 0.005) {
        for (const [k, b] of buckets) {
            b.times = b.times.filter((t) => now - t < b.windowMs);
            if (b.times.length === 0) buckets.delete(k);
        }
    }

    return { limited: false };
}

module.exports = { checkRateLimit };
