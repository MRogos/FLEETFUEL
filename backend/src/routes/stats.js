const router = require('express').Router();
const ctrl = require('../controllers/stats');

router.get('/dashboard', ctrl.dashboard);
router.get('/monthly', ctrl.monthly);
router.get('/vehicles', ctrl.perVehicle);

module.exports = router;
