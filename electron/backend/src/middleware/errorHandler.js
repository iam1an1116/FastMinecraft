export function errorHandler(err, req, res, next) {
  console.error('Error:', err.message);

  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File too large' });
  }

  if (err.message?.includes('directory traversal')) {
    return res.status(400).json({ error: 'Invalid path' });
  }

  res.status(err.status || 500).json({
    error: err.message || 'Internal server error'
  });
}
