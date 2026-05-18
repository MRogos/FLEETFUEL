const router = require('express').Router();

router.post('/login', (req, res) => {
  const { password } = req.body;
  const validPass = process.env.APP_PASSWORD || 'fleetfuel123';

  if (password === validPass) {
    req.session.authenticated = true;
    return res.json({ ok: true });
  }

  res.status(401).json({ error: 'Invalid password' });
});

router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

module.exports = router;
