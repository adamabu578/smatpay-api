const express = require('express');

const base = require('../controllers');
const { auth } = require('../middleware/auth');

const router = express.Router();

router.post('/signup', base.signUp);
router.post('/login', base.login);
router.get('/logout', base.logout);

router.get('/profile', auth, base.profile);

router.post('/topup', auth, base.topup);
router.post('/callback', base.callback);

module.exports = router;
