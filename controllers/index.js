const bcrypt = require("bcrypt");
const nodemailer = require("nodemailer");
const jwt = require("jsonwebtoken");
const fetch = require('node-fetch');
const randtoken = require('rand-token');
const moment = require("moment");

const catchAsync = require("../utils/catchAsync");
const Service = require("../models/service");
const Transaction = require("../models/transaction");
const User = require("../models/user");

exports.topup = catchAsync(async (req, res, next) => {
  // res.sendStatus(200);
  res.status(201).json({ code: '000', msg: 'Transaction initiated' });
  const q = await Service.findOne({ name: 'airtime' }, { _id: 1 });
  if (!q) return res.status(400).json();
  const arr = req.body.list;
  // for (let i = 0; i < arr.length; i++) {
  //   try {
  //     const rand = randtoken.generate(8, "01234567899876543210973243409877765463456789");
  //     const dt = new Intl.DateTimeFormat('en-NG', { timeZone: 'Africa/Lagos', month: '2-digit', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date());
  //     const d = dt.split(',')[0].split('/');
  //     const t = dt.split(',')[1].trim().split(':');
  //     const ref = `${d[2]}${d[1]}${d[0]}${t[0]}${t[1]}${rand}`;

  //     const resp = await fetch(`${process.env.VTPASS_API}/pay`, {
  //       method: 'POST',
  //       headers: { 'Content-Type': 'application/json', 'api-key': process.env.VTPASS_API_KEY, 'secret-key': process.env.VTPASS_SECRET_KEY },
  //       body: JSON.stringify({
  //         request_id: ref,
  //         serviceID: arr[i].newtork.toLowerCase(),
  //         amount: arr[i].price,
  //         phone: arr[i].msisdn
  //       }),
  //     });
  //     console.log('status', ':::', resp.status);
  //     const json = await resp.json();
  //     console.log('json', ':::', json);
  //   } catch (error) {

  //   }
  // }
});

exports.callback = catchAsync(async (req, res, next) => {
  res.status(200).json({ 'response': 'success' });
  console.log('callback', ':::', req.body);
});

exports.signUp = catchAsync(async (req, res, next) => {
  let otp;
  let otpExpiration;

  const firstname = req.body.firstname;
  const lastname = req.body.lastname;
  const email = req.body.email;
  const phoneNumber = req.body.phoneNumber;
  const userName = req.body.userName;
  const password = req.body.password;

  const userNameExists = await User.findOne({ userName: userName });
  const emailExists = await User.findOne({ email: email });

  if (userNameExists || emailExists)
    return res
      .status(500)
      .json({ status: "error", msg: "Username or Email already exists" });

  const hashedPassword = await bcrypt.hash(
    password,
    parseInt(process.env.PWD_HASH_LENGTH)
  );

  const user = new User({
    firstname,
    lastname,
    email,
    phoneNumber,
    userName,
    password: hashedPassword,
  });

  otp = Math.floor(1000 + Math.random() * 9000).toString();
  otpExpiration = moment().add(5, "minutes");
  // console.log('Generated OTP:', otp)
  // console.log('OTP Expiration:', otpExpiration.format('YYYY-MM-DD HH:mm:ss'))

  async function main() {
    let testAccount = await nodemailer.createTestAccount();

    let transporter = nodemailer.createTransport({
      host: process.env.MAIL_HOST,
      port: process.env.MAIL_PORT,
      secure: true, // true for 465, false for other ports
      auth: {
        user: process.env.MAIL_USER, // generated ethereal user
        pass: process.env.MAIL_PWD, // generated ethereal password
      },
    });

    console.log(transporter);

    // send mail with defined transport object
    let info = await transporter.sendMail({
      from: `"E-Series" <${process.env.MAIL_USER}>`, // sender address
      to: `${user.email}`, // list of receivers
      subject: "Your Account has been created", // Subject line

      html: `
           <h2>Hello there!</h2>
           <p>Your OTP is <em>${otp}</em></p>
           <p>Thanks for joining us</p>
           <p>Log in after your OTP has been verified</p>
           `,
    });

    console.log("Message sent: %s", info.messageId);
    // Message sent: <b658f8ca-6296-ccf4-8306-87d57a0b4321@example.com>
  }

  main();

  const payload = { userId: user._id, otp: otp, otpExpiration: otpExpiration };

  const token = jwt.sign({ payload }, process.env.UNAUTH_SECRET, {
    expiresIn: "400h",
  });

  req.session.token = token;

  const q = await user.save();

  res.status(200).json({ status: "success", msg: "Signed up successfully" });
});

exports.generateOtp = catchAsync(async (req, res, next) => {
  const q = await User.findOne({ _id: req.user.userId });

  const currentMoment = moment();
  const formattedDateTime = currentMoment.format("YYYY-MM-DD HH:mm:ss");

  if (formattedDateTime > req.user.otpExpiration) {
    let otp;
    let otpExpiration;

    otp = Math.floor(1000 + Math.random() * 9000).toString();
    otpExpiration = moment().add(5, "minutes");
    // console.log('Generated OTP:', otp)
    // console.log('OTP Expiration:', otpExpiration.format('YYYY-MM-DD HH:mm:ss'))

    async function main() {
      let testAccount = await nodemailer.createTestAccount();

      let transporter = nodemailer.createTransport({
        host: process.env.MAIL_HOST,
        port: process.env.MAIL_PORT,
        secure: true, // true for 465, false for other ports
        auth: {
          user: process.env.MAIL_USER, // generated ethereal user
          pass: process.env.MAIL_PWD, // generated ethereal password
        },
      });

      // console.log(transporter)

      // send mail with defined transport object
      let info = await transporter.sendMail({
        from: `"E-Series" <${process.env.MAIL_USER}>`, // sender address
        to: `${q.email}`, // list of receivers
        subject: "Your Account has been created", // Subject line

        html: `
           <h2>Hello there!</h2>
           <p>Your OTP is <em>${otp}</em></p>
           <p>Thanks for joining us</p>
           <p>Log in after your OTP has been verified</p>
           `,
      });

      // Message sent: <b658f8ca-6296-ccf4-8306-87d57a0b4321@example.com>
    }

    // main()
    req.user.otp = otp;
    req.user.otpExpiration = otpExpiration;

    res
      .status(200)
      .json({ status: "success", msg: "OTP generated successfully" });
  } else {
    res
      .status(400)
      .json({
        status: "error",
        msg: "OTP has not expired yet. Check your email",
      });
  }
});

exports.otpValidate = catchAsync(async (req, res, next) => {
  const userOTP = req.body.otp;
  const q = await User.findOne({ _id: req.user.userId });

  const currentMoment = moment();
  const formattedDateTime = currentMoment.format("YYYY-MM-DD HH:mm:ss");

  if (userOTP == req.user.otp && formattedDateTime < req.user.otpExpiration) {
    await User.updateOne({ _id: q._id }, { isVerified: 1 });

    res.status(200).json({ status: "success", msg: "OTP is valid" });
  } else {
    res
      .status(400)
      .json({ status: "error", message: "OTP is invalid or expired" });
  }
});

exports.login = catchAsync(async (req, res, next) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res
      .status(400)
      .json({ status: "error", msg: "Invalid email and/or password" });
  }

  const user = await User.findOne({ email }); //.select('+password')

  if (!user) {
    return res
      .status(401)
      .json({ status: "error", msg: "Invalid email and/or password" });
  }

  const isPasswordValid = bcrypt.compare(password, user.password);

  if (!isPasswordValid) {
    return res
      .status(401)
      .json({ status: "error", msg: "Invalid email and/or password" });
  }

  if (user.isVerified == 0) {
    return res
      .status(401)
      .json({ status: "error", msg: "User has not been verified" });
  }

  const payload = { userId: user._id, role: user.role };

  const token = jwt.sign({ payload }, process.env.AUTH_SECRET, {
    expiresIn: "400h",
  });
  req.session.token = token;

  // const q = {
  //   first_name: user.firstname,
  //   last_name: user.lastname,
  //   role: user.role,
  // };
  res.status(200).json({
    status: "success", msg: "Logged in",
    // data: q
  });
});

exports.profile = catchAsync(async (req, res, next) => {
  const q = await User.findOne({ _id: req.user.userId }, { password: 0 })

  res.status(200).json({ status: 'success', msg: 'Profile fetched', data: q })
});
