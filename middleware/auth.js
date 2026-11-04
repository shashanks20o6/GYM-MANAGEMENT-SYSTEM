function requireApiAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ message: 'Please log in to continue.' });
  }
  req.user = req.session.user;
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session || !req.session.user) {
      return res.status(401).json({ message: 'Please log in to continue.' });
    }
    if (!roles.includes(req.session.user.role)) {
      return res.status(403).json({ message: 'You do not have permission to perform this action.' });
    }
    req.user = req.session.user;
    next();
  };
}

function requirePageAuth(req, res, next) {
  if (!req.session || !req.session.user) return res.redirect('/login');
  req.user = req.session.user;
  next();
}

function requirePageRole(...roles) {
  return (req, res, next) => {
    if (!req.session || !req.session.user) return res.redirect('/login');
    if (!roles.includes(req.session.user.role)) return res.redirect('/dashboard');
    req.user = req.session.user;
    next();
  };
}

module.exports = { requireApiAuth, requireRole, requirePageAuth, requirePageRole };
