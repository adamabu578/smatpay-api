const express = require('express');

const base = require('../controllers');
const admin = require('../controllers/admin');
const bot = require('../controllers/bot');
const { auth, authAdmin } = require('../middleware/auth');

const router = express.Router();

router.get('/test', base.test);

router.post('/fcm/token', base.setFCMToken);
router.post('/fcm/push', base.fcmPushMsg);

router.post('/signup', base.signUp);
router.post('/login', base.login);
router.post('/otl', base.getOtl);
router.get('/otl/:token', base.otlLogin);
router.get('/logout', base.logout);
router.post('/password/request', base.sendPwdResetMail);
router.post('/password/reset', base.setPassword);

router.get('/profile', auth, base.profile);
router.get('/balance', auth, base.balance);
router.get('/referral/link', auth, base.referralLink);
router.post('/topup/init', auth, base.topupInit);

router.post('/vtu/airtime', auth, base.airtime);
router.get('/data/bundles', auth, base.listDataBundles);
router.post('/data', auth, base.subData);
router.get('/tv/plans', auth, base.listTVPlans);
router.post('/tv/card/verify', auth, base.verifySmartCardNo);
router.post('/tv/subscribe', auth, base.tvSub);
router.post('/tv/renew', auth, base.tvRenew);

router.post('/electricity/recipient/verify', auth, base.verifyMeterNo);
router.post('/electricity/purchase', auth, base.purchaseElectricity);

router.post('/airtime/to/cash', auth, base.airtime2Cash);

router.post('/epin/airtime', auth, base.genAirtimePin);
router.get('/epin/exam/:serviceCode', auth, base.previewExamPIN); //preview an exam PIN before purchase
router.post('/epin/exam/:serviceCode/verify', auth, base.verifyExamInput); //to verify any exam input e.g UTME profile code
router.post('/epin/exam', auth, base.buyExamPIN);

router.get('/transactions', auth, base.listTransactions);

router.post('/callback', base.callback); //vtpass
router.post('/webhook/epins', base.ePinsCallback);

router.post('/bot', bot.telegramBot);

router.get('/admin/balance', authAdmin, admin.freeBalance);

module.exports = router;
