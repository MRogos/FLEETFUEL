const router = require('express').Router();
const { body, param, query } = require('express-validator');
const ctrl = require('../controllers/refuels');
const validate = require('../middleware/validate');

router.get('/',
  query('vehicle_id').optional().isInt(),
  query('fuel_type').optional().isIn(['PB95','PB98','ON','LPG','EV']),
  query('month').optional().matches(/^\d{4}-\d{2}$/),
  query('driver_id').optional().isInt(),
  validate, ctrl.getAll
);

router.get('/:id', param('id').isInt(), validate, ctrl.getOne);

router.post('/',
  body('vehicle_id').isInt(),
  body('date').isDate(),
  body('liters').isFloat({ min: 0.01 }),
  body('fuel_type').optional().isIn(['PB95','PB98','ON','LPG','EV']),
  body('price_per_l').optional({ nullable: true }).isFloat({ min: 0 }),
  body('total').optional({ nullable: true }).isFloat({ min: 0 }),
  body('mileage').optional({ nullable: true }).isInt({ min: 0 }),
  body('driver_id').optional({ nullable: true }).isInt(),
  body('station').optional({ nullable: true }).trim(),
  body('notes').optional({ nullable: true }).trim(),
  validate, ctrl.create
);

router.put('/:id',
  param('id').isInt(),
  body('date').optional().isDate(),
  body('liters').optional().isFloat({ min: 0.01 }),
  body('fuel_type').optional().isIn(['PB95','PB98','ON','LPG','EV']),
  body('price_per_l').optional({ nullable: true }).isFloat({ min: 0 }),
  body('total').optional({ nullable: true }).isFloat({ min: 0 }),
  body('mileage').optional({ nullable: true }).isInt({ min: 0 }),
  body('driver_id').optional({ nullable: true }).isInt(),
  body('station').optional({ nullable: true }).trim(),
  body('notes').optional({ nullable: true }).trim(),
  validate, ctrl.update
);

router.delete('/:id', param('id').isInt(), validate, ctrl.remove);

module.exports = router;
