const router = require('express').Router();
const ctrl = require('../controllers/stats');

router.get('/dashboard', ctrl.dashboard);
router.get('/monthly', ctrl.monthly);
router.get('/vehicles', ctrl.perVehicle);
router.get('/monthly-vehicles', ctrl.monthlyPerVehicle);
router.get('/monthly-mileage', ctrl.monthlyMileage);
router.get('/drivers', ctrl.perDriver);
router.get('/costs-per-vehicle', ctrl.costsPerVehicleMonth);

module.exports = router;
