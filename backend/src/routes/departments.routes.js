const express = require('express');
const {
  listDepartments, createDepartment, updateDepartment, deleteDepartment,
  createSubDepartment, updateSubDepartment, deleteSubDepartment,
} = require('../controllers/departments.controller');
const { requireAuth, requireCapability } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

router.get('/', listDepartments); // everyone signed in: forms need the structure

const manage = requireCapability('structure.manage');
router.post('/', manage, createDepartment);
router.patch('/:id', manage, updateDepartment);
router.delete('/:id', manage, deleteDepartment);

router.post('/:id/sub-departments', manage, createSubDepartment);

module.exports = router;
