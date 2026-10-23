const express = require('express');
const { updateSubDepartment, deleteSubDepartment } = require('../controllers/departments.controller');
const { requireAuth, requireCapability } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth, requireCapability('structure.manage'));

router.patch('/:id', updateSubDepartment);
router.delete('/:id', deleteSubDepartment);

module.exports = router;
