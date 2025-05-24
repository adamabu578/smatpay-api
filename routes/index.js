const express = require('express');

const base = require('../controllers');
const { auth } = require('../middleware/auth');

const router = express.Router();

router.post('/signup', base.signUp);
router.post('/login', base.login);

// router.get('/logout', base.logout);
router.post('/forgot-password', base.sendPwdResetMail);
router.post('/reset-password', base.setPassword); 

router.get('/profile', auth, base.profile);
router.post('/virtual-account', auth, base.setupVirtualAccount);
router.get('/balance', auth, base.balance);

// router.post('/topup/init', auth, base.topupInit);

router.post('/airtime', auth, base.airtime);
router.get('/data/bundle/:network', auth, base.listDataBundles);
router.post('/data', auth, base.subData);

router.get('/tv/plans', auth, base.listTVPlans);
router.post('/tv/verify-smart-card', auth, base.verifySmartCardNo);
router.post('/tv/subscribe', auth, base.tvSub);
router.post('/tv/renew', auth, base.tvRenew);

router.post('/electricity/recipient/verify', auth, base.getElectCustomer);
router.post('/electricity/purchase', auth, base.purchaseElectricity);

router.get('/history', auth, base.listTransactions);

router.get('/banks', base.listBanks);
router.get('/bank/account-number', base.resolveBankAccount);

router.post('/webhook/paystack', base.paystackWebhook); 

module.exports = router;
