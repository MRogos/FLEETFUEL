module.exports = (req, res, next) => {
  // Przepuszczamy: login page, auth routes, publiczne assety
  const publicPaths = ['/login.html', '/api/auth/login', '/css/', '/js/'];
  const isPublic = publicPaths.some(p => req.path.startsWith(p));

  if (isPublic) return next();

  if (req.session && req.session.authenticated) return next();

  // API zwraca 401, strony przekierowują na /login.html
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  res.redirect('/login.html');
};
