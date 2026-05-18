const router = require('express').Router();
const { body, param } = require('express-validator');
const ctrl = require('../controllers/vehicles');
const validate = require('../middleware/validate');

router.get('/', ctrl.getAll);
router.get('/:id', param('id').isInt(), validate, ctrl.getOne);

router.post('/',
  body('name').notEmpty().trim(),
  body('plate').notEmpty().trim(),
  body('year').optional().isInt({ min: 1980, max: 2030 }),
  body('fuel_type').optional().isIn(['PB95','PB98','ON','LPG','EV']),
  body('mileage').optional().isInt({ min: 0 }),
  validate,
  ctrl.create
);

router.put('/:id',
  param('id').isInt(),
  body('name').optional().notEmpty().trim(),
  body('plate').optional().notEmpty().trim(),
  body('year').optional().isInt({ min: 1980, max: 2030 }),
  body('fuel_type').optional().isIn(['PB95','PB98','ON','LPG','EV']),
  body('mileage').optional().isInt({ min: 0 }),
  validate,
  ctrl.update
);

router.delete('/:id', param('id').isInt(), validate, ctrl.remove);

module.exports = router;
