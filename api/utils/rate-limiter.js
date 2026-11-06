/**
 * Simple in-memory rate limiter with sliding window
 * For production, consider using Redis-backed rate limiting
 */

class RateLimiter {
  constructor() {
    this.requests = new Map();
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
  }

  cleanup() {
    const now = Date.now();
    for (const [key, data] of this.requests.entries()) {
      if (now - data.firstRequest > data.windowMs) {
        this.requests.delete(key);
      }
    }
  }

  check(key, maxRequests, windowMs) {
    const now = Date.now();
    const data = this.requests.get(key);

    if (!data) {
      this.requests.set(key, {
        count: 1,
        firstRequest: now,
        windowMs
      });
      return { allowed: true, remaining: maxRequests - 1 };
    }

    if (now - data.firstRequest > windowMs) {
      this.requests.set(key, {
        count: 1,
        firstRequest: now,
        windowMs
      });
      return { allowed: true, remaining: maxRequests - 1 };
    }

    if (data.count >= maxRequests) {
      const retryAfter = Math.ceil((data.firstRequest + windowMs - now) / 1000);
      return { 
        allowed: false, 
        remaining: 0,
        retryAfter
      };
    }

    data.count++;
    this.requests.set(key, data);
    return { allowed: true, remaining: maxRequests - data.count };
  }

  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.requests.clear();
  }
}

const globalLimiter = new RateLimiter();

const RATE_LIMITS = {
  FORGOT_PASSWORD: {
    max: parseInt(process.env.FORGOT_PASSWORD_RATE_LIMIT) || 3,
    window: 60 * 60 * 1000
  },
  RESET_PASSWORD: {
    max: parseInt(process.env.RESET_PASSWORD_RATE_LIMIT) || 5,
    window: 60 * 60 * 1000
  },
  ACTIVATE_ACCOUNT: {
    max: parseInt(process.env.ACTIVATE_ACCOUNT_RATE_LIMIT) || 5,
    window: 60 * 60 * 1000
  },
  ADMIN_SEND_RESET: {
    max: parseInt(process.env.ADMIN_SEND_RESET_RATE_LIMIT) || 10,
    window: 60 * 60 * 1000
  }
};

function rateLimitMiddleware(type) {
  return (req, res, next) => {
    const limit = RATE_LIMITS[type];
    if (!limit) {
      return next();
    }

    let key;
    if (type === 'FORGOT_PASSWORD') {
      key = `forgot:${req.body.email?.toLowerCase() || 'unknown'}`;
    } else if (type === 'RESET_PASSWORD' || type === 'ACTIVATE_ACCOUNT') {
      key = `${type}:${req.body.token?.substring(0, 20) || 'unknown'}`;
    } else if (type === 'ADMIN_SEND_RESET') {
      key = `admin_reset:${req.user?.id}:${req.params.userId}`;
    } else {
      key = `${type}:${req.ip}`;
    }

    const result = globalLimiter.check(key, limit.max, limit.window);

    res.setHeader('X-RateLimit-Limit', limit.max);
    res.setHeader('X-RateLimit-Remaining', result.remaining);

    if (!result.allowed) {
      res.setHeader('X-RateLimit-Reset', Math.ceil(Date.now() / 1000) + result.retryAfter);
      res.setHeader('Retry-After', result.retryAfter);
      
      sails.config.customLogger.log('warn', `Rate limit exceeded for ${type}: ${key}`, null, 'message', null);
      
      return res.status(429).json({
        message: 'Too many requests. Please try again later.',
        retryAfter: result.retryAfter
      });
    }

    next();
  };
}

module.exports = {
  RateLimiter,
  rateLimitMiddleware,
  RATE_LIMITS,
  globalLimiter
};
