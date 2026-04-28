const express = require('express');

const admin = require('../controllers/admin');
const { isAdmin } = require('../middleware/auth');
const base = require('../controllers/index');

const router = express.Router();

router.use(isAdmin);

router.get('/profile', base.profile); // Admins can use the regular profile endpoint

router.get('/dashboard-metrics', admin.dashboardMetrics);
router.get('/analytics', admin.analytics);

router.get('/transactions', admin.listTransactions);
router.get('/transaction/:id', admin.getTransaction);

router.get('/users', admin.listUsers);
router.get('/user/:id', admin.getUser);
router.put('/user/:id', admin.updateUser);
router.post('/user/topup', admin.topupUser);

router.get('/services', admin.listServices);
router.put('/service/:id', admin.updateService);

module.exports = router;
