const bcrypt = require("bcrypt");
// const nodemailer = require("nodemailer");
const jwt = require("jsonwebtoken");
const fetch = require('node-fetch');
const randtoken = require('rand-token');
const { uid } = require("uid");
const firebase = require('firebase-admin');
const { default: mongoose } = require("mongoose");

const catchAsync = require("../helpers/catchAsync");

const Transaction = require("../models/transaction");
const User = require("../models/user");

const P = require('../helpers/params');
const AppError = require("../helpers/AppError");
const { pExCheck, calcServicePrice, createPDF, genHTMLTemplate, initTransaction, updateTransaction, afterTransaction, getServiceVariations, getAmtFromVariations } = require("../helpers/utils");
const Service = require("../models/service");
const { DEFAULT_LOCALE, TIMEZONE } = require("../helpers/consts");
// const { vEvent, VEVENT_ACCOUNT_CREATED, VEVENT_NEW_REFERRAL } = require("../event/class");

exports.paystackWebhook = catchAsync(async (req, res, next) => {
  res.sendStatus(200);
  console.log('paystackWebhook', req.body);
});

exports.signUp = catchAsync(async (req, res, next) => {
  const params = [P.firstName, P.lastName, P.email, P.phone, P.password];
  const missing = pExCheck(req.body, params);
  if (missing.length != 0) return next(new AppError(400, 'Missing fields.', missing));

  req.body[P.phone] = req.body[P.phone].replace('+', ''); //in case the number starts with +

  const filter = [{ 'email': req.body[P.email] }, { 'phone': req.body[P.phone] }];

  const q = await User.find({ $or: filter });
  if (q.length != 0 && q[0]?.email == req.body[P.email]) return next(new AppError(400, 'Account with email already exists'));
  else if (q.length != 0 && q[0]?.phone == req.body[P.phone]) return next(new AppError(400, 'Account with phone already exists'));

  req.body[P.password] = bcrypt.hashSync(req.body[P.password], parseInt(process.env.PWD_HASH_LENGTH));

  const q2 = await User.create({ firstName: req.body[P.firstName], lastName: req.body[P.lastName], email: req.body[P.email], phone: req.body[P.phone], password: req.body[P.password] });
  if (!q2) return next(new AppError(500, 'Could not create account.'));

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

  const payload = { email: req.body[P.email] };

  const token = jwt.sign({ payload }, process.env.PRE_AUTH_SECRET, { expiresIn: 60 * 30 }); //Expires in 30 mins
  console.log(token);

  res.status(200).json({ status: 'success', msg: 'We have sent you a mail.' });
});

exports.setPassword = catchAsync(async (req, res, next) => {
  const missing = pExCheck(req.body, [P.password, P.token]);
  if (missing.length != 0) return next(new AppError(400, 'Missing fields.', missing));

  const { payload } = jwt.verify(req.body[P.token], process.env.PRE_AUTH_SECRET);

  const user = await User.findOne({ 'uid.email': payload[P.email] });

  if (!user) return next(new AppError(400, 'Invalid account'));

  const password = bcrypt.hashSync(req.body.password, parseInt(process.env.PWD_HASH_LENGTH));

  const q = await User.updateOne({ 'uid.email': payload[P.email] }, { password });
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
      $project: { firstName: 1, lastName: 1, email: 1, phone: 1, createdAt: 1 }
    },
    {
      $project: { _id: 0 }
    }
  ]);

  res.status(200).json({ status: 'success', msg: 'Profile fetched', data: q[0] });
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
  console.log('req.body', req.query);
  const missing = pExCheck(req.query, [P.provider]);
  if (missing.length != 0) return next(new AppError(400, 'Missing fields.', missing));

  const resp = await fetch(`${process.env.VTPASS_API}/service-variations?serviceID=${req.query[P.provider]}`, {
    // headers: { 'api-key': process.env.VTPASS_API_KEY, 'secret-key': process.env.VTPASS_SECRET_KEY },
    headers: { 'api-key': process.env.VTPASS_API_KEY, 'public-key': process.env.VTPASS_PUB_KEY },
  });
  const json = await resp.json();
  if (json?.response_description != '000') return next(new AppError(400, 'Cannot list plans.'));

  res.status(200).json({ status: 'success', msg: 'Plans listed', data: json?.content?.variations ?? json?.content?.varations });
});

exports.verifySmartCardNo = catchAsync(async (req, res, next) => {
  const missing = pExCheck(req.body, [P.provider, P.cardNumber]);
  if (missing.length != 0) return next(new AppError(400, 'Missing fields.', missing));

  const resp = await fetch(`${process.env.VTPASS_API}/merchant-verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api-key': process.env.VTPASS_API_KEY, 'secret-key': process.env.VTPASS_SECRET_KEY },
    body: JSON.stringify({ serviceID: req.body[P.provider], billersCode: req.body[P.cardNumber] }),
  });
  const json = await resp.json();
  if (json?.code != '000') return next(new AppError(500, 'Cannot verify smartcard number.'));
  if (json?.content?.error) return next(new AppError(400, json?.content?.error));

  res.status(200).json({ status: 'success', msg: 'Smartcard details', data: json?.content });
});

exports.tvSub = catchAsync(async (req, res, next) => {
  const missing = pExCheck(req.body, [P.provider, P.cardNumber, P.planId, P.amount, P.phone]);
  if (missing.length != 0) return next(new AppError(400, 'Missing fields.', missing));

  const service = await Service.findOne({ code: 'cable-tv' });
  if (!service) return next(new AppError(500, 'Service error'));

  req.body[P.recipient] = req.body[P.cardNumber];
  req.body[P.provider] = req.body[P.provider].toLowerCase();
  // req.body[P.serviceId] = service._id;
  // req.body[P.commissionType] = COMMISSION_TYPE.RATE;
  // req.body[P.commissionKey] = `${req.body[P.provider]}`;

  initTransaction(req, service, next, async (transactionId) => {
    const resp = await fetch(`${process.env.VTPASS_API}/pay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': process.env.VTPASS_API_KEY, 'secret-key': process.env.VTPASS_SECRET_KEY },
      body: JSON.stringify({
        request_id: transactionId,
        serviceID: req.body[P.provider],
        billersCode: req.body[P.cardNumber],
        variation_code: req.body[P.planId],
        amount: req.body[P.amount],
        phone: req.body[P.phone],
        subscription_type: 'change',
        quantity: 1 //The number of months viewing month e.g 1 (otional)
      }),
    });
    const json = await resp.json();
    const { respCode, status, msg, obj } = afterTransaction(transactionId, json, VENDORS.VTPASS);
    res.status(respCode).json({ status, msg });
    updateTransaction(obj, req.user.id);
  });
});

exports.tvRenew = catchAsync(async (req, res, next) => {
  const missing = pExCheck(req.body, [P.provider, P.cardNumber, P.amount, P.phone]);
  if (missing.length != 0) return next(new AppError(400, 'Missing fields.', missing));

  const service = await Service.findOne({ code: 'cable-tv' });
  if (!service) return next(new AppError(500, 'Service error'));

  req.body[P.recipient] = req.body[P.cardNumber];
  req.body[P.provider] = req.body[P.provider].toLowerCase();
  // req.body[P.serviceId] = service._id;
  // req.body[P.commissionType] = COMMISSION_TYPE.RATE;
  // req.body[P.commissionKey] = `${req.body[P.provider]}`;

  initTransaction(req, service, next, async (transactionId) => {
    const resp = await fetch(`${process.env.VTPASS_API}/pay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': process.env.VTPASS_API_KEY, 'secret-key': process.env.VTPASS_SECRET_KEY },
      body: JSON.stringify({
        request_id: transactionId,
        serviceID: req.body[P.provider],
        billersCode: req.body[P.cardNumber],
        amount: req.body[P.amount],
        phone: req.body[P.phone],
        subscription_type: 'renew'
      }),
    });
    const json = await resp.json();
    const { respCode, status, msg, obj } = afterTransaction(transactionId, json, VENDORS.VTPASS);
    res.status(respCode).json({ status, msg });
    updateTransaction(obj, req.user.id);
  });
});

exports.airtime2Cash = catchAsync(async (req, res, next) => {
  const missing = pExCheck(req.body, [P.provider, P.creditSource, P.amount]);
  if (missing.length != 0) return next(new AppError(400, 'Missing fields.', missing));
  if (isNaN(req.body[P.amount])) return next(new AppError(400, `${P.denomination} must be a number`));

  // const DV = { 100: 1, 200: 2, 400: 4, 500: 5, 750: 7.5, 1000: 10, 1500: 15 }; //denominations 

  req.body[P.provider] = req.body[P.provider].toLowerCase();

  const serviceCode = `airtime-2-cash`;

  const service = await Service.findOne({ code: serviceCode }); // { _id: 1, templates: 1 }
  if (!service) return next(new AppError(500, 'Invalid service code'));

  // req.body[P.serviceId] = service._id;
  req.body[P.recipient] = 'N/A';
  // req.body[P.amount] = req.body[P.denomination];
  // req.body[P.commissionType] = COMMISSION_TYPE.AMOUNT;
  // req.body[P.commissionKey] = `pin-${req.body[P.provider]}-${req.body[P.denomination]}`;
  // req.body[P.serviceVariation] = req.body[P.denomination];

  const networkCode = BIZ_KLUB_NETWORK_CODES[req.body[P.provider]];

  initTransaction(req, service, next, async (transactionId, option) => {
    const resp = await fetch(process.env.BIZ_KLUB_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestType: "ATC",
        networkCode: networkCode,
        creditSource: req.body[P.creditSource],
        amount: req.body[P.amount],
        requestReference: transactionId,
        encodedKey: BIZ_KLUB_KEY
      }),
    });
    const json = await resp.json();
    const { respCode, status, msg, obj } = afterTransaction(transactionId, json, VENDORS.BIZKLUB);
    res.status(respCode).json({ status, msg });
    updateTransaction(obj, req.user.id);
  });
});

exports.genAirtimePin = catchAsync(async (req, res, next) => {
  const missing = pExCheck(req.body, [P.provider, P.denomination, P.quantity, P.nameOnCard]);
  if (missing.length != 0) return next(new AppError(400, 'Missing fields.', missing));
  if (isNaN(req.body[P.denomination])) return next(new AppError(400, `${P.denomination} must be a number`));
  if (isNaN(req.body[P.quantity])) return next(new AppError(400, `${P.quantity} must be a number`));

  // const DV = { 100: 1, 200: 2, 400: 4, 500: 5, 750: 7.5, 1000: 10, 1500: 15 }; //denominations 

  req.body[P.provider] = req.body[P.provider].toLowerCase();

  const serviceCode = `epin-${req.body[P.provider]}-${req.body[P.denomination]}`;

  const service = await Service.findOne({ code: serviceCode }); // { _id: 1, templates: 1 }
  if (!service) return next(new AppError(500, 'Invalid service code'));

  // req.body[P.serviceId] = service._id;
  req.body[P.recipient] = 'N/A';
  req.body[P.amount] = req.body[P.denomination];
  // req.body[P.commissionType] = COMMISSION_TYPE.AMOUNT;
  // req.body[P.commissionKey] = `pin-${req.body[P.provider]}-${req.body[P.denomination]}`;
  req.body[P.serviceVariation] = req.body[P.denomination];

  const networkCode = BIZ_KLUB_NETWORK_CODES[req.body[P.provider]];

  initTransaction(req, service, next, async (transactionId, option) => {
    const resp = await fetch(process.env.BIZ_KLUB_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestType: "EPIN",
        networkCode: networkCode,
        pinDenomination: req.body[P.denomination],
        pinQuantity: req.body[P.quantity],
        pinFormat: "Standard",
        requestReference: transactionId,
        encodedKey: BIZ_KLUB_KEY
      }),
    });
    if (resp.status != 200) return next(new AppError(500, 'Sorry! we are experiencing a downtime.'));
    const json = await resp.json();
    const { respCode, status, msg, obj } = afterTransaction(transactionId, json, VENDORS.BIZKLUB);
    updateTransaction(obj, req.user.id);

    if (respCode != 200) return next(new AppError(respCode, msg));

    const resp2 = await fetch(process.env.BIZ_KLUB_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestType: "F-EPIN",
        networkCode: networkCode,
        pinFormat: "Standard",
        requestReference: transactionId,
        encodedKey: BIZ_KLUB_KEY
      }),
    });
    const json2 = await resp2.json();
    if (json2?.statusCode != 200) return next(new AppError(respCode, 'Oops! incomplete request.'));
    obj.respObj = {
      pins: json2.pins.map(i => {
        const item = i.pindata.split(',');
        return { pin: item[1], sn: item[0] };
      })
    };
    res.status(respCode).json({ status, msg });
    updateTransaction(obj, req.user.id);
    if (obj?.respObj) {
      const pinArr = obj.respObj.pins.map(i => ({ ...i, provider: req.body[P.provider].toUpperCase(), denomination: req.body[P.denomination] }));
      const template = service.templates?.[req.body[P.denomination]];
      const path = await createPDF(option.id, genHTMLTemplate(template, req.body[P.nameOnCard], pinArr));
      const fileName = `${req.body[P.provider].toUpperCase()} N${req.body[P.denomination]} [${req.body[P.quantity]}].pdf`;
      sendTelegramDoc(option.telegramId, path, { fileName, deleteOnSent: true });
    }

    // const resp = await fetch(`${process.env.EPIN_API}/epin/`, {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify({
    //     apikey: process.env.EPIN_KEY,
    //     service: "epin",
    //     network: req.body[P.provider],
    //     pinDenomination: DV[req.body[P.denomination]],
    //     pinQuantity: req.body[P.quantity],
    //     ref: transactionId
    //   }),
    // });
    // if (resp.status != 200) return next(new AppError(500, 'Sorry! we are experiencing a downtime.'));
    // const json = await resp.json();
    // const { respCode, status, msg, obj } = afterTransaction(transactionId, json, VENDORS.EPINS);
    // res.status(respCode).json({ status, msg });
    // updateTransaction(obj, req.user.id);
    // if (obj.respObj) {
    //   const path = await createPDF(option.id, req.body[P.provider].toUpperCase(), req.body[P.denomination], req.body[P.nameOnCard], obj.respObj.pins);
    //   const fileName = `${req.body[P.provider].toUpperCase()} N${req.body[P.denomination]} (${req.body[P.quantity]}).pdf`;
    //   sendTelegramDoc(option.telegramId, path, { fileName, deleteOnSent: true });
    // }
  });
});

exports.previewExamPIN = catchAsync(async (req, res, next) => {
  const missing = pExCheck(req.params, [P.serviceCode]);
  if (missing.length != 0) return next(new AppError(400, 'Missing fields.', missing));

  const service = await Service.findOne({ code: req.params[P.serviceCode] });
  console.log('previewExamPIN :::', 'service :::', service);
  if (!service) return next(new AppError(500, 'Invalid service'));

  const variations = await getVariations(service?.vendorCode);
  console.log('variations :::', variations);
  if (!variations) return next(new AppError(400, 'Cannot list variations.'));
  // const variations = json?.content?.variations ?? json?.content?.varations;
  const pin = (variations?.filter(i => i?.variation_code == service?.vendorVariationCode))[0];
  // console.log('previewExamPIN ::: pin :::', pin);

  res.status(200).json({
    status: 'success',
    msg: 'PIN details',
    data: {
      name: service.title,
      serviceCode: service.code,
      amount: calcServicePrice(service, { vendorPrice: pin.variation_amount })
    }
  });
});

exports.verifyExamInput = catchAsync(async (req, res, next) => {
  const fields = Object.keys(req.body);
  if (fields.length == 0) return next(new AppError(400, 'Nothing to verify.'));

  const field = fields[0]; //only a field is expected at a time

  const validFields = [P.profileCode];

  if (!validFields.includes(field)) return next(new AppError(400, 'Invalid field.'));

  const service = await Service.findOne({ code: req.params[P.serviceCode] });
  if (!service) return next(new AppError(500, 'Invalid service'));

  const resp = await fetch(`${process.env.VTPASS_API}/merchant-verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api-key': process.env.VTPASS_API_KEY, 'secret-key': process.env.VTPASS_SECRET_KEY },
    body: JSON.stringify({ serviceID: service.vendorCode, billersCode: req.body[P.profileCode], type: service.vendorVariationCode }),
  });
  // console.log('verifyExamInput ::: resp.status :::', resp.status);
  const json = await resp.json();
  // console.log('verifyExamInput ::: json :::', json);
  if (json?.code != '000') return next(new AppError(500, `Cannot verify ${field}.`));
  if (json?.content?.error) return next(new AppError(400, json?.content?.error));

  res.status(200).json({ status: 'success', msg: 'Verified details', data: json?.content });
});

exports.buyExamPIN = catchAsync(async (req, res, next) => {
  const missing = pExCheck(req.body, [P.serviceCode]);
  if (missing.length != 0) return next(new AppError(400, 'Missing fields.', missing));

  const { format } = req.query;

  const service = await Service.findOne({ code: req.body[P.serviceCode] });
  if (!service) return next(new AppError(500, 'Invalid service type'));

  const variations = await getVariations(service?.vendorCode);
  if (!variations) return next(new AppError(400, 'Cannot list variations.'));

  // const varationAmount = getAmtFromVariations(json, req.body[P.variationCode]);
  const variationAmount = getAmtFromVariations(variations, service?.vendorVariationCode);
  if (!variationAmount) return next(new AppError(400, 'Invalid variation code'));
  const amount = calcServicePrice(service, { vendorPrice: variationAmount });

  if (!req.body?.[P.recipient]) {
    const q = await User.findOne({ role: ROLES.admin }, { uid: 1 });
    req.body[P.recipient] = q.uid.phone;
  }

  req.body[P.amount] = amount;
  req.body[P.quantity] = req.body?.[P.quantity] ?? 1;

  initTransaction(req, service, next, async (transactionId, options) => {
    // const resp = await fetch(`${process.env.EPIN_API}/waec/`, {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify({
    //     apikey: process.env.EPIN_KEY,
    //     service: "waec",
    //     vcode: 'waecdirect',
    //     // amount:
    //     ref: transactionId
    //   }),
    // });
    // if (resp.status != 200) return next(new AppError(500, 'Sorry! we are experiencing a downtime.'));
    // console.log('buyExamPIN ::: resp.status :::', resp.status);
    // const json = await resp.json();
    // console.log('buyExamPIN ::: json :::', json);
    // const { respCode, status, msg, obj } = afterTransaction(transactionId, json, VENDORS.EPINS);

    const body = {
      request_id: transactionId,
      serviceID: service.vendorCode,
      // variation_code: req.body[P.variationCode],
      variation_code: service?.vendorVariationCode,
      quantity: req.body[P.quantity],
      phone: req.body[P.recipient]
    };
    if (req.body?.[P.profileCode]) { //case of utme
      body.billersCode = req.body[P.profileCode];
    }
    // console.log('buyExamPIN ::: body :::', body);
    const resp = await fetch(`${process.env.VTPASS_API}/pay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': process.env.VTPASS_API_KEY, 'secret-key': process.env.VTPASS_SECRET_KEY },
      body: JSON.stringify(body),
    });
    // console.log('buyExamPIN ::: resp.status :::', resp.status);
    const json = await resp.json();
    // console.log('buyExamPIN ::: json :::', json);
    const { respCode, status, msg, obj } = afterTransaction(transactionId, json, VENDORS.VTPASS);

    updateTransaction(obj, options);
    let jsonResp = { status, msg };
    if (obj?.respObj) {
      let fileName = `${service.title} [${req.body[P.quantity]}]`;
      if (format == 'pdf') {
        fileName += '.pdf';
        // sendTelegramDoc(option.telegramId, path, { fileName, deleteOnSent: true });
        // bot.sendMessage(option.telegramId, JSON.stringify(obj.respObj));
        jsonResp.msg = 'File sent to your telegram';
      } else {
        jsonResp.description = fileName;
        if (obj?.respObj?.pins) {
          jsonResp.pins = obj.respObj.pins;
        }
      }
    }
    res.status(respCode).json(jsonResp);
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
  res.status(200).json({ status: 'success', msg: 'Balances fetched', data: { link: `${process.env.TELEGRAM_BOT_LINK}?start=${q?.referralCode}` } });
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

exports.verifyMeterNo = catchAsync(async (req, res, next) => {
  const missing = pExCheck(req.body, [P.provider, P.recipient, P.type]);
  if (missing.length != 0) return next(new AppError(400, 'Missing fields.', missing));

  const resp = await fetch(`${process.env.VTPASS_API}/merchant-verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api-key': process.env.VTPASS_API_KEY, 'secret-key': process.env.VTPASS_SECRET_KEY },
    body: JSON.stringify({ serviceID: req.body[P.provider], billersCode: req.body[P.recipient], type: req.body[P.type] }),
  });
  const json = await resp.json();
  if (json?.code != '000') return next(new AppError(500, 'Cannot verify smartcard number.'));
  if (json?.content?.error) return next(new AppError(400, json?.content?.error));

  res.status(200).json({ status: 'success', msg: 'Smartcard details', data: json?.content });
});

exports.purchaseElectricity = catchAsync(async (req, res, next) => {
  const missing = pExCheck(req.body, [P.provider, P.recipient, P.type, P.amount, P.phone]);
  if (missing.length != 0) return next(new AppError(400, 'Missing fields.', missing));

  const service = await Service.findOne({ code: req.body[P.provider] });
  console.log('service', service);
  if (!service) return next(new AppError(500, 'Invalid provider'));

  // const variations = await getVariations(service?.vendorCode);
  // if(!variations) return next(new AppError(400, 'Cannot list variations.'));

  // const varationAmount = getAmtFromVariations(variations, req.body[P.variationCode]);
  // if (!varationAmount) return next(new AppError(400, 'Invalid variation code'));
  // const amount = calcServicePrice(service, { vendorPrice: varationAmount });

  // if (!req.body?.[P.recipient]) {
  //   const q = await User.findOne({ role: ROLES.admin }, { uid: 1 });
  //   req.body[P.recipient] = q.uid.phone;
  // }

  // req.body[P.amount] = amount;
  // req.body[P.quantity] = req.body?.[P.quantity] ?? 1;

  initTransaction(req, service, next, async (transactionId, option) => {
    const resp = await fetch(`${process.env.VTPASS_API}/pay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': process.env.VTPASS_API_KEY, 'secret-key': process.env.VTPASS_SECRET_KEY },
      body: JSON.stringify({
        request_id: transactionId,
        // serviceID: service.vendorCode,
        serviceID: req.body[P.provider],
        billersCode: req.body[P.recipient],
        variation_code: req.body[P.type],
        amount: req.body[P.amount],
        phone: req.body[P.phone]
      }),
    });
    const json = await resp.json();
    console.log('JSON :::', json);
    const { respCode, status, msg, obj } = afterTransaction(transactionId, json, VENDORS.VTPASS);
    updateTransaction(obj, req.user.id);
    let jsonResp = { status, msg };
    if (obj?.respObj) {
      jsonResp.token = obj.respObj.token;
    }
    res.status(respCode).json(jsonResp);
  });
});
