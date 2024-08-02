const express = require('express');

const base = require('../controllers');
const admin = require('../controllers/admin');
const bot = require('../controllers/bot');
const { auth, authAdmin } = require('../middleware/auth');

const router = express.Router();

router.post('/signup', base.signUp);
router.post('/login', base.login);
router.get('/logout', base.logout);

router.get('/profile', auth, base.profile);
router.get('/balance', auth, base.balance);
router.post('/topup/init', auth, base.topupInit);

router.post('/airtime/vtu', auth, base.airtime);
router.get('/data/bundles', auth, base.listDataBundles);
router.post('/data', auth, base.subData);
router.get('/tv/plans', auth, base.listTVPlans);
router.post('/tv/card/verify', auth, base.verifySmartCardNo);
router.post('/tv/subscribe', auth, base.tvSub);
router.post('/tv/renew', auth, base.tvRenew);

router.get('/epin/exam', auth, base.getExamPIN);
router.post('/epin/exam', auth, base.buyExamPIN);
router.post('/epin/airtime', auth, base.generatePin);

router.get('/transactions', auth, base.listTransactions);
// router.get('/transactions/merge', auth, base.mergeTransaction);

router.post('/callback', base.callback); //vtpass
router.post('/webhook/epins', base.ePinsCallback);

router.post('/bot', bot.telegramBot);

router.get('/admin/balance', authAdmin, admin.freeBalance);

module.exports = router;
