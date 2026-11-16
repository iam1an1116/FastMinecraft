const CSRF_HEADER = 'x-fm-token';

export function securityMiddleware(req, res, next) {
  // CSRF protection for state-changing methods
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const token = req.headers[CSRF_HEADER];
    if (!token || token !== 'fm-local-token') {
      // Allow in development
      if (process.env.NODE_ENV !== 'production') {
        return next();
      }
      return res.status(403).json({ error: 'Invalid CSRF token' });
    }
  }

  // Prevent directory traversal
  if (req.url.includes('..')) {
    return res.status(400).json({ error: 'Invalid path' });
  }

  next();
}
