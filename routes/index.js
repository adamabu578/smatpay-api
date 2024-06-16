const express = require('express');

// const { preAuth, authStudent, authAdmin, auth } = require('../middleware/auth');

const base = require('../controllers');
// const user = require('../controllers/userController');
// const student = require('../controllers/studentController');
// const admin = require('../controllers/adminController');

const router = express.Router();

router.post('/signup', base.signUp);
// router.post('/login', user.login);
// router.post('/otp/generate', preAuth, user.generateOtp);
// router.post('/otp/validate', preAuth, user.otpValidate);

// router.get('/profile', auth, user.profile);

// router.get('/years', authStudent, student.listYears);
// router.get('/questions', authStudent, student.getQuestions);
// router.get('/schools', authStudent, student.listSchools);
// router.get('/exams', authStudent, student.fetchExams);
// router.get('/subjects', authStudent, student.fetchSubjects);

// router.post('/chat/group/create', authAdmin, admin.createChatGroup);
// router.get('/chat', authAdmin, admin.createChat);

router.post('/topup', base.topup);
router.post('/callback', base.topup);

module.exports = router;
