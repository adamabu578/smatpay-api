const bcrypt = require("bcrypt");
// const nodemailer = require("nodemailer");
const jwt = require("jsonwebtoken");
const fetch = require('node-fetch');
const randtoken = require('rand-token');
const { uid } = require("uid");

const catchAsync = require("../helpers/catchAsync");
const Service = require("../models/service");
const Transaction = require("../models/transaction");
const User = require("../models/user");

const P = require('../helpers/params');
const AppError = require("../helpers/AppError");
const { pExCheck, genRefNo } = require("../helpers/utils");
const { default: mongoose } = require("mongoose");

exports.signUp = catchAsync(async (req, res, next) => {
  const missing = pExCheck(req.body, [P.firstName, P.lastName, P.email, P.phone, P.password]);
  if (missing.length != 0) return next(new AppError(400, 'Missing fields.', missing));

  const { firstName, lastName, email, phone } = req.body;

  const q = await User.find({ $or: [{ 'uid.email': email }, { 'uid.phone': phone }] });
  console.log('Q :::', q);
  if (q.length != 0) return next(new AppError(400, 'Account with email/phone already exists'));

  const password = bcrypt.hashSync(req.body.password, parseInt(process.env.PWD_HASH_LENGTH));

  const q2 = await User.create({ uid: { email, phone }, name: { first: firstName, last: lastName }, password });
  if (!q2) return next(new AppError(500, 'Could not create account.'));

  res.status(200).json({ status: "success", msg: "Account created." });
});

exports.login = catchAsync(async (req, res, next) => {
  const missing = pExCheck(req.body, [P.email, P.password]);
  if (missing.length != 0) return next(new AppError(400, 'Missing fields.', missing));

  const user = await User.findOne({ 'uid.email': req.body.email });

  if (!user) return next(new AppError(400, 'Invalid email and/or password'));

  const isPasswordValid = bcrypt.compareSync(req.body.password, user.password);

  if (!isPasswordValid) return next(new AppError(400, 'Invalid email and/or password'));

  const payload = { id: user._id.toHexString(), firstName: user.firstName };

  const token = jwt.sign({ payload }, process.env.AUTH_SECRET, { expiresIn: 60 * 30 }); //Expires in 30 mins

  req.session.token = token;

  res.status(200).json({ status: "success", msg: "Logged in" });
});

exports.logout = catchAsync(async (req, res, next) => {
  req.session.destroy();
  res.status(200).json({ status: 'success', msg: 'Logged out' });
});

exports.profile = catchAsync(async (req, res, next) => {
  const q = await User.aggregate([
    {
      $match: { _id: new mongoose.Types.ObjectId(req.user.id) }
    },
    {
      $project: { id: '$_id', firstName: 1, lastName: 1, testKey: 1, liveKey: 1 }
    },
    {
      $project: { _id: 0 }
    }
  ]);

  res.status(200).json({ status: 'success', msg: 'Profile fetched', data: q[0] })
});

const singleTopup = catchAsync(async (req, res, next) => {
  const missing = pExCheck(req.body, [P.provider, P.recipient, P.amount]);
  if (missing.length != 0) return next(new AppError(400, 'Missing fields.', missing));

  const q = await Service.findOne({ name: 'airtime' }, { _id: 1 });
  if (!q) return next(new AppError(500, 'Service error'));

  const q2 = await User.findOne({ _id: req.user.id }, { balance: 1, commission: 1 });

  const amount = req.body[P.amount];
  const totalAmount = amount - ((amount * q2.commission) / 100);
  const balance = q2.balance;
  const balanceAfter = balance - totalAmount;
  if (balanceAfter < 0) return next(new AppError(409, 'Insufficient balance'));

  const commission = amount - totalAmount;

  const q3 = await Transaction.find({ userId: req.user.id, recipient: req.body[P.recipient], tags: req.body.tags });
  if (q3.length != 0) return next(new AppError(400, 'Duplicate transaction')); //transaction with tags for recipient already exist

  const q4 = await User.updateOne({ _id: req.user.id }, { balance: balanceAfter });
  if (q4?.modifiedCount != 1) return next(new AppError(500, 'Account error'));

  const transactionId = genRefNo();
  await Transaction.create({ userId: req.user.id, transactionId, serviceId: q._id, recipient: req.body[P.recipient], unitPrice: amount, commission, amount, totalAmount, balanceBefore:balance, balanceAfter, tags: req.body?.tags });

  const resp = await fetch(`${process.env.VTPASS_API}/pay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api-key': process.env.VTPASS_API_KEY, 'secret-key': process.env.VTPASS_SECRET_KEY },
    body: JSON.stringify({
      request_id: transactionId,
      serviceID: req.body[P.provider].toLowerCase(),
      amount,
      phone: req.body[P.recipient]
    }),
  });
  const json = await resp.json();
  res.status(201).json({ code: '000', msg: json.content?.transactions?.status == 'delivered' ? 'Transaction successful' : 'Transaction initiated' });
  await Transaction.updateOne({ transactionId: json.requestId }, { status: json.content.transactions.status, statusDesc: json?.response_description })
});

const bulkTopup = catchAsync(async (req, res, next) => {
  const q = await Service.findOne({ name: 'airtime' }, { _id: 1 });
  if (!q) return next(new AppError(500, 'Service error'));

  res.status(201).json({ code: '000', msg: 'Transaction initiated' });

  const arr = req.body.list;
  for (let i = 0; i < arr.length; i++) {
    try {
      const q2 = await Transaction.find({ recipient: arr[i].msisdn, tags: req.body.tags });
      if (q2.length == 0) { //transaction with tags for recipient does not exist
        const rand = randtoken.generate(8, "01234567899876543210973243409877765463456789");
        const dt = new Intl.DateTimeFormat('en-NG', { timeZone: 'Africa/Lagos', month: '2-digit', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date());
        const d = dt.split(',')[0].split('/');
        const t = dt.split(',')[1].trim().split(':');
        const ref = `${d[2]}${d[1]}${d[0]}${t[0]}${t[1]}${rand}`;

        await Transaction.create({ userId: req.user.id, transactionId: ref, serviceId: q._id, recipient: arr[i].msisdn, unitPrice: arr[i].price, totalAmount: arr[i].price, tags: req.body?.tags });

        const resp = await fetch(`${process.env.VTPASS_API}/pay`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'api-key': process.env.VTPASS_API_KEY, 'secret-key': process.env.VTPASS_SECRET_KEY },
          body: JSON.stringify({
            request_id: ref,
            serviceID: arr[i].network.toLowerCase(),
            amount: arr[i].price,
            phone: arr[i].msisdn
          }),
        });
        const json = await resp.json();
        console.log('JSON', ':::', json);
        await Transaction.updateOne({ transactionId: json.requestId }, { status: json.content.transactions.status, statusDesc: json?.response_description })
      }
    } catch (error) {
      console.log('topup', ':::', 'error', ':::', error);
    }
  }
});

exports.topup = catchAsync(async (req, res, next) => {
  if (req.body?.list) {
    bulkTopup(req, res, next);
  } else {
    singleTopup(req, res, next);
  }
});

exports.callback = catchAsync(async (req, res, next) => {
  res.status(200).json({ 'response': 'success' });
  const testKey = 'tk' + uid(20);
  const liveKey = 'lk' + uid(20);
  console.log('callback', ':::', req.body, ':::', testKey, ':::', liveKey);
});
