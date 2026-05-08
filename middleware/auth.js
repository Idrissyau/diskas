function requireAuth(req, res, next) {
  if (!req.session.user) {
    req.flash('error', 'Please log in to continue.');
    return res.redirect('/auth/login');
  }
  if (req.session.user.status === 'banned') {
    req.session.destroy();
    req.flash('error', 'Your account has been banned.');
    return res.redirect('/auth/login');
  }
  res.locals.currentUser = req.session.user;
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/auth/login');
  }
  if (!['admin', 'moderator'].includes(req.session.user.role)) {
    return res.status(403).render('errors/403', { title: 'Forbidden' });
  }
  next();
}

function requireSuperAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).render('errors/403', { title: 'Forbidden' });
  }
  next();
}

function setLocals(req, res, next) {
  res.locals.currentUser = req.session.user || null;
  res.locals.flashSuccess = req.flash('success');
  res.locals.flashError = req.flash('error');
  res.locals.flashInfo = req.flash('info');
  res.locals.appUrl = process.env.APP_URL || 'https://diskas.idrisyau.com';
  res.locals.canonicalPath = req.path;
  // Default SEO values — controllers can override these
  res.locals.metaDesc = 'Diskas — a free community to find jobs, learn new skills, ask questions, and connect with people from all backgrounds.';
  res.locals.ogImage = null;
  res.locals.pageSchema = null;
  next();
}

module.exports = { requireAuth, requireAdmin, requireSuperAdmin, setLocals };
