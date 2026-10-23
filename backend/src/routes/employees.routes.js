const express = require('express');
const {
  listEmployees, getEmployee, createEmployee, updateEmployee, resetPassword, getPhoto, setPhoto,
} = require('../controllers/employees.controller');
const { requireAuth, requireCapability } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

router.get('/', requireCapability('employees.view'), listEmployees); // limited to the caller's scope
router.post('/', requireCapability('employees.manage'), createEmployee);
router.get('/:id/photo', getPhoto); // yourself, or anyone inside your scope
router.put('/:id/photo', requireCapability('employees.manage'), setPhoto);
router.get('/:id', getEmployee); // yourself, or anyone inside your scope
router.patch('/:id', requireCapability('employees.manage'), updateEmployee);
router.patch('/:id/password', requireCapability('employees.manage'), resetPassword);

module.exports = router;
