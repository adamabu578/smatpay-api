const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const fetch = require('node-fetch');
const { uid } = require("uid");
const { default: mongoose } = require("mongoose");

const crypto = require('node:crypto');

const catchAsync = require("../helpers/catchAsync");

const Transaction = require("../models/transaction");
const User = require("../models/user");

const P = require('../helpers/params');
const AppError = require("../helpers/AppError");
const { pExCheck, initTransaction, updateTransaction, afterTransaction, getServiceVariations, getAmtFromVariations, createNUBAN, createPaystackCustomer, validatePaystackCustomer, genRefNo, sendEmail, createPayscribeCustomer } = require("../helpers/utils");
const Service = require("../models/service");
const { DEFAULT_LOCALE, TIMEZONE, TRANSACTION_STATUS, NUBAN_PROVIDER } = require("../helpers/consts");

exports.paystackWebhook = catchAsync(async (req, res, next) => {
  res.sendStatus(200);

  const hash = crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY).update(JSON.stringify(req.body)).digest('hex');
  if (hash == req.headers['x-paystack-signature']) {
    const body = req.body;
    if (body.event == "charge.success") {
      // console.log('body?.data?.metadata', body?.data?.metadata);
      const amount = body.data.amount / 100; //convert kobo to naira
      const totalAmount = amount;
      const q = await User.find({ 'paystackCustomer.code': body?.data?.customer.customer_code, 'virtualAccounts.accountNumber': body?.data?.metadata.receiver_account_number });
      if (q?.length == 1) {
        const user = q[0];
        const q2 = await Service.findOne({ code: 'wallet-topup' }, { _id: 1 });
        const session = await mongoose.startSession();
        try {
          const transactionId = genRefNo();
          session.startTransaction();
          const q3 = await User.updateOne({ _id: user._id }, { $inc: { balance: totalAmount } }).session(session);
          // console.log('q3 :::', q3);
          const respObj = { reference: body?.data?.reference };
          const q4 = await Transaction.create([{ userId: user._id, transactionId, serviceId: q2._id, recipient: 'wallet', unitPrice: amount, quantity: 1, amount, totalAmount, status: TRANSACTION_STATUS.DELIVERED, statusDesc: 'Wallet topup', respObj }], { session });
          // console.log('q4 :::', q4);
          if (q3?.modifiedCount == 1 && q4?.length > 0) {
            await session.commitTransaction();
          }
        } catch (error) {
          await session.abortTransaction();
          console.error('Error during transaction:', error);
        } finally {
          session.endSession();
        }
      }
    }
  }
});

exports.signUp = catchAsync(async (req, res, next) => {
  const params = [P.firstName, P.lastName, P.email, P.phone, P.password];
  if (req.body?.[P.assignNuban] == 'yes' && req.body?.[P.nubanProvider] == NUBAN_PROVIDER.PAYSTACK) {
    params.push(P.bvn);
    params.push(P.accountNumber);
    params.push(P.bankCode);
  }
  const missing = pExCheck(req.body, params);
  if (missing.length != 0) return next(new AppError(400, 'Missing fields.', missing));

  req.body[P.phone] = req.body[P.phone].replace('+', ''); //in case the number starts with +

  const filter = [{ 'email': req.body[P.email] }, { 'phone': req.body[P.phone] }];

  const q = await User.find({ $or: filter });
  if (q.length != 0 && q[0]?.email == req.body[P.email]) return next(new AppError(400, 'Account with email already exists'));
  else if (q.length != 0 && q[0]?.phone == req.body[P.phone]) return next(new AppError(400, 'Account with phone already exists'));

  req.body[P.password] = bcrypt.hashSync(req.body[P.password], parseInt(process.env.PWD_HASH_LENGTH));

  const data = { firstName: req.body[P.firstName], lastName: req.body[P.lastName], email: req.body[P.email], phone: req.body[P.phone], password: req.body[P.password] };
  if (req.body?.[P.bvn]) {
    data[P.bvn] = req.body[P.bvn]
  }
  if (req.body?.[P.accountNumber]) {
    data[P.accountNumber] = req.body[P.accountNumber]
  }
  if (req.body?.[P.bankCode]) {
    data[P.bankCode] = req.body[P.bankCode]
  }

  const q2 = await User.create(data);
  if (!q2) return next(new AppError(500, 'Could not create account.'));

  if (req.body?.[P.assignNuban] == 'yes') {
    // const customer = await createPaystackCustomer(req.body[P.email], req.body[P.firstName], req.body[P.lastName], req.body[P.phone]);
    const customer = await createPayscribeCustomer(req.body[P.email], req.body[P.firstName], req.body[P.lastName], req.body[P.phone]);
    // if (!customer?.data) return next(new AppError(201, 'Account created. Unable to setup virtual account number. Kindly login to continue.'));
    if (!customer?.message?.details?.customer_id) return next(new AppError(201, 'Account created. Unable to setup virtual account number. Kindly login to continue.'));
    // await User.updateOne({ _id: q2._id }, { 'paystackCustomer.code': customer.data.customer_code });
    await User.updateOne({ _id: q2._id }, { 'payscribeCustomer.id': customer.message.details.customer_id });
    // const validate = await validatePaystackCustomer(customer.data.customer_code, req.body[P.firstName], req.body[P.lastName], req.body[P.bvn], req.body[P.accountNumber], req.body[P.bankCode]);
    // if (validate.status != 'success') return next(new AppError(201, 'Account created. Unable to validate virtual account credentials. Kindly login to continue.'));
    // await User.updateOne({ _id: q2._id }, { 'paystackCustomer.isValidated': true });
    // const nuban = await createNUBAN(customer.data.customer_code);
    const nuban = await createNUBAN(customer.message.details.customer_id);
    if (!nuban) return next(new AppError(201, 'Account created. Unable to setup virtual account. Kindly login to continue.'));
    await User.updateOne({ _id: q2._id }, { $push: { virtualAccounts: nuban } });
  }

  res.status(200).json({ status: "success", msg: "Account created. Kindly login." });
});

const afterLogin = async (req, res, user) => {
  const secret = uid(32);

  await User.updateOne({ _id: user._id }, { token: secret });

  const payload = { id: user._id.toHexString(), token: secret };

  const token = jwt.sign({ payload }, process.env.AUTH_SECRET);

  res.status(200).json({ status: "success", msg: "Logged in", token });
}

exports.login = catchAsync(async (req, res, next) => {
  const missing = pExCheck(req.body, [P.email, P.password]);
  if (missing.length != 0) return next(new AppError(400, 'Missing fields.', missing));

  const user = await User.findOne({ email: req.body.email });

  if (!user) return next(new AppError(400, 'Invalid email and/or password'));

  const isPasswordValid = bcrypt.compareSync(req.body.password, user.password);

  if (!isPasswordValid) return next(new AppError(400, 'Invalid email and/or password'));

  afterLogin(req, res, user);
});

exports.sendPwdResetMail = catchAsync(async (req, res, next) => {
  const missing = pExCheck(req.body, [P.email]);
  if (missing.length != 0) return next(new AppError(400, 'Missing fields.', missing));

  const resetPwdToken = uid(35);
  const payload = { email: req.body[P.email], token: resetPwdToken };

  const q = await User.updateOne({ email: payload[P.email] }, { resetPwdToken });
  if (q?.modifiedCount != 1) return next(new AppError(400, 'Account error.'));

  const token = jwt.sign({ payload }, process.env.UNAUTH_SECRET, { expiresIn: 60 * 30 }); //Expires in 30 mins

  const link = `${process.env.WEB_URL}/reset-password?token=${token}`;

  await sendEmail(req.body[P.email], 'Forgot Password', `Kindly click <a href="${link}">here</a> to reset your password<br><br>Link expires in 30 mins.`);

  res.status(200).json({ status: 'success', msg: 'We have sent you a mail. Link expires in 30 mins.' });
});

exports.setPassword = catchAsync(async (req, res, next) => {
  const missing = pExCheck(req.body, [P.password, P.token]);
  if (missing.length != 0) return next(new AppError(400, 'Missing fields.', missing));

  const { payload } = jwt.verify(req.body[P.token], process.env.UNAUTH_SECRET);

  const user = await User.findOne({ email: payload[P.email] });

  if (!user) return next(new AppError(400, 'Invalid account'));
  if (user?.resetPwdToken != payload.token) return next(new AppError(400, 'Invalid token'));

  const password = bcrypt.hashSync(req.body.password, parseInt(process.env.PWD_HASH_LENGTH));

  const resetPwdToken = uid(35);
  const q = await User.updateOne({ email: payload[P.email] }, { password, resetPwdToken });
  if (q.modifiedCount != 1) return next(new AppError(500, 'Request not successful'));

  res.status(200).json({ status: 'success', msg: 'Request successful' });
});


// exports.logout = catchAsync(async (req, res, next) => {
//   req.session.destroy();
//   res.status(200).json({ status: 'success', msg: 'Logged out' });
// });

exports.profile = catchAsync(async (req, res, next) => {
  const q = await User.aggregate([
    {
      $match: { _id: new mongoose.Types.ObjectId(req.user.id) }
    },
    {
      $project: { firstName: 1, lastName: 1, email: 1, phone: 1, createdAt: 1, virtualAccounts: 1 }
    },
    {
      $project: { _id: 0 }
    }
  ]);

  res.status(200).json({ status: 'success', msg: 'Profile fetched', data: q[0] });
});

exports.setupVirtualAccount = catchAsync(async (req, res, next) => {
  const params = [];
  if (req.body?.[P.nubanProvider] == NUBAN_PROVIDER.PAYSTACK) {
    params.push(P.bvn);
    params.push(P.accountNumber);
    params.push(P.bankCode);
  }
  const missing = pExCheck(req.body, params);
  if (missing.length != 0) return next(new AppError(400, 'Missing fields.', missing));

  const provider = req.body?.[P.nubanProvider] ?? NUBAN_PROVIDER.PAYSCRIBE;

  const q = await User.find({ _id: req.user.id });
  if (q.length != 1) return next(new AppError(400, 'Account does not exist.'));

  const user = q[0];

  if (user?.virtualAccounts?.filter(i => i.provider == provider).length > 0) return next(new AppError(400, 'A virtual account already exists for this user.'));

  const obj = { paystackCustomer: user?.paystackCustomer, payscribeCustomer: user?.payscribeCustomer };

  if (provider == NUBAN_PROVIDER.PAYSTACK && !obj?.paystackCustomer?.code) {
    // console.log('setupVirtualAccount ::: createPaystackCustomer');
    const customer = await createPaystackCustomer(user[P.email], user[P.firstName], user[P.lastName], user[P.phone]);
    if (!customer?.data) return next(new AppError(500, 'Unable to create customer on Paystack. Kindly try again.'));
    obj.paystackCustomer = { code: customer.data.customer_code };
    await User.updateOne({ _id: user._id }, { 'paystackCustomer.code': customer.data.customer_code });
  }
  if (provider == NUBAN_PROVIDER.PAYSTACK && !obj?.paystackCustomer?.isValidated && obj?.paystackCustomer?.code) {
    // console.log('setupVirtualAccount ::: validatePaystackCustomer');
    const validate = await validatePaystackCustomer(obj.paystackCustomer.code, user[P.firstName], user[P.lastName], req.body[P.bvn], req.body[P.accountNumber], req.body[P.bankCode]);
    if (validate.status != 'success') return next(new AppError(500, 'Unable to validate credentials. Kindly try again.'));
    obj.paystackCustomer.isValidated = true;
    await User.updateOne({ _id: user._id }, { bvn: req.body[P.bvn], accountNumber: req.body[P.accountNumber], bankCode: req.body[P.bankCode], 'paystackCustomer.isValidated': true });
  }
  if (provider == NUBAN_PROVIDER.PAYSTACK && !obj?.paystackCustomer?.isValidated) return next(new AppError(500, 'Unable to validate customer. Kindly try again.'));

  if (provider == NUBAN_PROVIDER.PAYSCRIBE && !obj?.payscribeCustomer?.id) {
    // console.log('setupVirtualAccount ::: createPayscribeCustomer');
    const customer = await createPayscribeCustomer(user[P.email], user[P.firstName], user[P.lastName], user[P.phone]);
    if (!customer?.message?.details?.customer_id) return next(new AppError(500, 'Unable to create customer on Payscribe. Kindly try again.'));
    obj.payscribeCustomer = { id: customer.message.details.customer_id };
    await User.updateOne({ _id: user._id }, { 'payscribeCustomer.id': customer.message.details.customer_id });
  }

  let customerID;
  if (provider == NUBAN_PROVIDER.PAYSCRIBE && obj?.payscribeCustomer?.id) {
    customerID = obj.payscribeCustomer.id;
  } else if (provider == NUBAN_PROVIDER.PAYSTACK && obj?.paystackCustomer?.code) {
    customerID = obj.paystackCustomer.code;
  }
  console.log('customerID :::', customerID);
  if (!customerID) return next(new AppError(500, 'Unable to create customer. Kindly try again.'));

  // console.log('setupVirtualAccount ::: createNUBAN');
  const nuban = await createNUBAN(customerID);
  if (!nuban) return next(new AppError(500, 'Unable to setup a virtual account at this moment. Kindly try again later.'));
  await User.updateOne({ _id: user._id }, { $push: { virtualAccounts: nuban } });

  res.status(200).json({ status: "success", msg: "Virtual account created.", data: nuban });
});

exports.airtime = catchAsync(async (req, res, next) => {
  const missing = pExCheck(req.body, [P.operator, P.phoneNumber, P.amount]);
  if (missing.length != 0) return next(new AppError(400, 'Missing fields.', missing));

  req.body[P.recipient] = req.body[P.phoneNumber];

  const service = await Service.findOne({ code: `airtime` });
  if (!service) return next(new AppError(500, 'Service error'));

  initTransaction(req, service, next, async (transactionId, options) => {
    const resp = await fetch(`${process.env.V24U_API}/vtu/airtime`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.V24U_SECRET}` },
      body: JSON.stringify({
        provider: req.body[P.operator],
        recipient: req.body[P.phoneNumber],
        amount: req.body[P.amount],
      }),
    });
    // console.log('resp.status :::', resp.status);
    const json = await resp?.json();
    const { respCode, status, msg, obj } = afterTransaction(transactionId, resp.status, json);
    // console.log(respCode, ':::', status, ':::', msg, ':::', obj);
    res.status(respCode).json({ status, msg, data: { transactionId } });
    updateTransaction(obj, options);
  });
});

exports.listDataBundles = catchAsync(async (req, res, next) => {
  const missing = pExCheck(req.params, [P.network]);
  if (missing.length != 0) return next(new AppError(400, 'Missing fields.', missing));

  const bundles = await getServiceVariations(`/data/bundles?provider=${req.params[P.network]}`);
  if (!bundles) return next(new AppError(400, 'Cannot list bundles.'));

  res.status(200).json({ status: 'success', msg: 'Bundle listed', data: bundles });
});

exports.subData = catchAsync(async (req, res, next) => {
  const missing = pExCheck(req.body, [P.network, P.phoneNumber, P.bundleCode]);
  if (missing.length != 0) return next(new AppError(400, 'Missing fields.', missing));

  req.body[P.recipient] = req.body[P.phoneNumber];

  const service = await Service.findOne({ code: `data` });
  if (!service) return next(new AppError(500, 'Invalid service'));

  const bundles = await getServiceVariations(`/data/bundles?provider=${req.body[P.network]}`);
  if (!bundles) return next(new AppError(400, 'Cannot list bundles.'));
  const variationAmount = getAmtFromVariations(bundles, req.body[P.bundleCode]);
  if (!variationAmount) return next(new AppError(400, 'Invalid bundle code'));
  req.body[P.amount] = variationAmount;

  initTransaction(req, service, next, async (transactionId, options) => {
    const resp = await fetch(`${process.env.V24U_API}/data`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.V24U_SECRET}` },
      body: JSON.stringify({
        provider: req.body[P.network],
        recipient: req.body[P.phoneNumber],
        bundleCode: req.body[P.bundleCode],
      }),
    });
    // console.log('resp.status :::', resp.status);
    const json = await resp?.json();
    const { respCode, status, msg, obj } = afterTransaction(transactionId, resp.status, json);
    // console.log(respCode, ':::', status, ':::', msg, ':::', obj);
    res.status(respCode).json({ status, msg, data: { transactionId } });
    updateTransaction(obj, options);
  });
});

exports.listTVPlans = catchAsync(async (req, res, next) => {
  const missing = pExCheck(req.query, [P.provider]);
  if (missing.length != 0) return next(new AppError(400, 'Missing fields.', missing));

  const resp = await fetch(`${process.env.V24U_API}/tv/plans?provider=${req.query[P.provider]}`, {
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.V24U_SECRET}` }
  });
  // console.log('listTVPlans ::: resp.status :::', resp.status);
  if (resp.status != 200) return next(new AppError(500, 'Cannot retrieve plans.'));
  const json = await resp.json();
  // console.log('listTVPlans ::: json :::', json);
  res.status(200).json({ status: 'success', msg: 'Plans listed', data: json.data });
});

exports.verifySmartCardNo = catchAsync(async (req, res, next) => {
  const missing = pExCheck(req.body, [P.provider, P.cardNumber]);
  if (missing.length != 0) return next(new AppError(400, 'Missing fields.', missing));

  const resp = await fetch(`${process.env.V24U_API}/tv/card/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.V24U_SECRET}` },
    body: JSON.stringify({ provider: req.body[P.provider], cardNumber: req.body[P.cardNumber] }),
  });
  // console.log('verifySmartCardNo ::: resp.status :::', resp.status);
  if (resp.status != 200) return next(new AppError(500, 'Cannot verify smartcard number.'));
  const json = await resp.json();
  // console.log('verifySmartCardNo ::: json :::', json);
  res.status(200).json({ status: 'success', msg: 'Smartcard details', data: json.data });
});

exports.tvSub = catchAsync(async (req, res, next) => {
  const missing = pExCheck(req.body, [P.provider, P.cardNumber, P.planCode, P.amount, P.phone]);
  if (missing.length != 0) return next(new AppError(400, 'Missing fields.', missing));

  req.body[P.recipient] = req.body[P.cardNumber];
  req.body[P.provider] = req.body[P.provider].toLowerCase();

  const service = await Service.findOne({ code: `tv-${req.body[P.provider]}` });
  if (!service) return next(new AppError(500, 'Service error'));

  initTransaction(req, service, next, async (transactionId, option) => {
    const resp = await fetch(`${process.env.V24U_API}/tv/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.V24U_SECRET}` },
      body: JSON.stringify({
        provider: req.body[P.provider],
        cardNumber: req.body[P.cardNumber],
        planCode: req.body[P.planCode],
        amount: req.body[P.amount],
        phone: req.body[P.phone]
      }),
    });
    // console.log('tvSub ::: status :::', resp.status);
    const json = await resp.json();
    // console.log('tvSub ::: JSON :::', json);
    const { respCode, status, msg, obj } = afterTransaction(transactionId, resp.status, json);
    // console.log(respCode, ':::', status, ':::', msg, ':::', obj);
    res.status(respCode).json({ status, msg, data: json.data });
    updateTransaction(obj, option);
  });
});

exports.tvRenew = catchAsync(async (req, res, next) => {
  const missing = pExCheck(req.body, [P.provider, P.cardNumber, P.amount, P.phone]);
  if (missing.length != 0) return next(new AppError(400, 'Missing fields.', missing));

  req.body[P.recipient] = req.body[P.cardNumber];
  req.body[P.provider] = req.body[P.provider].toLowerCase();

  const service = await Service.findOne({ code: `tv-${req.body[P.provider]}` });
  if (!service) return next(new AppError(500, 'Service error'));

  initTransaction(req, service, next, async (transactionId, option) => {
    const resp = await fetch(`${process.env.V24U_API}/tv/renew`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.V24U_SECRET}` },
      body: JSON.stringify({
        provider: req.body[P.provider],
        cardNumber: req.body[P.cardNumber],
        amount: req.body[P.amount],
        phone: req.body[P.phone]
      }),
    });
    // console.log('tvRenew ::: status :::', resp.status);
    const json = await resp.json();
    // console.log('tvRenew ::: JSON :::', json);
    const { respCode, status, msg, obj } = afterTransaction(transactionId, resp.status, json);
    // console.log(respCode, ':::', status, ':::', msg, ':::', obj);
    res.status(respCode).json({ status, msg, data: json.data });
    updateTransaction(obj, option);
  });
});

exports.listTransactions = catchAsync(async (req, res, next) => {
  const maxPerPage = 50;
  let { id, recipient, status, tags, page, perPage, order } = req.query;
  page = parseInt(page, 10) || 1;
  perPage = parseInt(perPage, 10) || maxPerPage;
  perPage = perPage > maxPerPage ? maxPerPage : perPage;

  const filter = { userId: new mongoose.Types.ObjectId(req.user.id) };
  if (id) {
    filter.transactionId = { $in: id.split(',').filter(i => i != '') };
  }
  if (recipient) {
    filter.recipient = { $in: recipient.split(',').filter(i => i != '') };
  }
  if (status) {
    filter.status = { $in: status.split(',').filter(i => i != '') };
  }
  if (tags) {
    filter.tags = { $in: tags.split(',').filter(i => i != '') };
  }
  const arr = [
    { $sort: { _id: order?.toLowerCase() == 'asc' ? 1 : -1 } },
    { $skip: (page - 1) * perPage },
    { $limit: perPage },
    { $project: { service: '$serviceId', serviceVariation: 1, recipient: 1, unitPrice: 1, quantity: 1, discount: 1, totalAmount: 1, status: 1, tags: 1, createdAt: 1, statusDescription: '$statusDesc' } },
    { $project: { _id: 0 } }
  ];
  const _q = await Transaction.aggregate([
    {
      $match: filter
    },
    {
      $facet: {
        count: [{ $count: 'total' }],
        data: arr,
      }
    }
  ]);

  const q = _q[0].data;

  const serviceIDs = new Set(); //values should be strings, or a mixture of numbers and strings
  for (let i = 0; i < q.length; i++) {
    serviceIDs.add(q[i].service.toHexString());
  }

  const q2 = q.length > 0 ? await Service.find({ _id: { $in: Array.from(serviceIDs) } }) : [];

  const services = {};

  const json = { status: 'success', msg: 'Transactions listed' };
  for (let i = 0; i < q2.length; i++) {
    services[q2[i]._id] = q2[i].title;
  }

  const list = q.map(i => {
    const d = new Date(new Date(i.createdAt).toLocaleString(DEFAULT_LOCALE, { timeZone: TIMEZONE }));
    return { ...i, service: services[i.service], createdAt: d.toLocaleString() };
  });
  json.data = list;
  json.metadata = { page, perPage, total: _q[0].count[0]?.total ?? 0 };
  if (page * perPage < json.metadata.total) {
    json.metadata.nextPage = page + 1;
  }
  res.status(200).json(json);
});

exports.balance = catchAsync(async (req, res, next) => {
  const q = await User.findOne({ _id: req.user.id }, { balance: 1, referralBonus: 1 });
  res.status(200).json({ status: 'success', msg: 'Balances fetched', data: { wallet: q?.balance, bonus: q?.referralBonus } });
});

exports.referralLink = catchAsync(async (req, res, next) => {
  const q = await User.findOne({ _id: req.user.id }, { referralCode: 1 });
  res.status(200).json({ status: 'success', msg: 'Referral link fetched', data: { link: `${process.env.TELEGRAM_BOT_LINK}?start=${q?.referralCode}` } });
});

exports.topupInit = catchAsync(async (req, res, next) => {
  const q = await User.findOne({ _id: req.user.id }, { 'uid.email': 1 });

  const resp = await fetch(`${process.env.PAYSTACK_BASE_URL}/transaction/initialize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
    body: JSON.stringify({
      email: q.uid.email,
      amount: req.body.amount * 100,
      metadata: { api: 'vtu', uid: q._id, service: 'topup' },
    }),
  });
  const json = await resp.json();
  console.log('JSON', ':::', json);

  res.status(200).json({ status: 'success', msg: 'Balance fetched' });
});

exports.getElectCustomer = catchAsync(async (req, res, next) => {
  const missing = pExCheck(req.body, [P.provider, P.recipient, P.type]);
  if (missing.length != 0) return next(new AppError(400, 'Missing fields.', missing));

  const service = await Service.findOne({ code: `electric-${req.body[P.provider]}` });
  if (!service) return next(new AppError(500, 'Service error'));

  const resp = await fetch(`${process.env.V24U_API}/electricity/recipient/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.V24U_SECRET}` },
    body: JSON.stringify({
      provider: req.body[P.provider],
      recipient: req.body[P.recipient],
      type: req.body[P.type],
    }),
  });
  // console.log('getElectCustomer ::: resp.status :::', resp.status);
  if (resp.status != 200) return next(new AppError(500, 'Cannot verify customer.'));
  const json = await resp.json();
  // console.log('getElectCustomer ::: json :::', json);
  res.status(200).json({ status: 'success', msg: 'Customer details', data: json.data });
});

exports.purchaseElectricity = catchAsync(async (req, res, next) => {
  // console.log('purchaseElectricity ::: req.user :::', req.user);
  const missing = pExCheck(req.body, [P.provider, P.recipient, P.type, P.amount, P.phone]);
  if (missing.length != 0) return next(new AppError(400, 'Missing fields.', missing));

  const service = await Service.findOne({ code: `electric-${req.body[P.provider]}` });
  if (!service) return next(new AppError(500, 'Service error'));

  const mResp = await fetch(`${process.env.V24U_API}/electricity/recipient/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.V24U_SECRET}` },
    body: JSON.stringify({ provider: req.body[P.provider], recipient: req.body[P.recipient], type: req.body[P.type] }),
  });
  const mJson = await mResp.json();
  if (mResp.status != 200) return next(new AppError(500, mJson?.msg ?? 'Cannot verify customer.'));

  initTransaction(req, service, next, async (transactionId, option) => {
    const resp = await fetch(`${process.env.V24U_API}/electricity/purchase`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.V24U_SECRET}` },
      body: JSON.stringify({
        provider: req.body[P.provider],
        recipient: req.body[P.recipient],
        type: req.body[P.type],
        amount: req.body[P.amount],
        phone: req.body[P.phone]
      }),
    });
    // console.log('purchaseElectricity ::: status :::', resp.status);
    const json = await resp.json();
    // console.log('purchaseElectricity ::: JSON :::', json);
    const { respCode, status, msg, obj } = afterTransaction(transactionId, resp.status, json);
    // console.log(respCode, ':::', status, ':::', msg, ':::', obj);
    res.status(respCode).json({ status, msg, data: json.data });
    updateTransaction(obj, option);
  });
});

exports.listBanks = catchAsync(async (req, res, next) => {
  const resp = await fetch(`${process.env.PAYSTACK_API}/bank`, {
    headers: { 'Authorization': `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
  });
  if (resp.status != 200) return next(new AppError(500, 'An error occured.'));
  const json = await resp.json();
  res.status(200).json({ status: 'success', msg: 'Banks listed', data: json?.data });
});

exports.resolveBankAccount = catchAsync(async (req, res, next) => {
  const resp = await fetch(`${process.env.PAYSTACK_API}/bank/resolve?account_number=${req.query.accountNumber}&bank_code=${req.query.bankCode}`, {
    headers: { 'Authorization': `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
  });
  if (resp.status != 200) return next(new AppError(500, 'An error occured.'));
  const json = await resp.json();
  res.status(200).json({ status: 'success', msg: 'Account resolved', data: json?.data });
});