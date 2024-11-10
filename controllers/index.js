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
const { pExCheck, calcServicePrice, createPDF, genHTMLTemplate, initTransaction2, initTransaction, updateTransaction, afterTransaction } = require("../helpers/utils");
const { default: mongoose } = require("mongoose");
const { TIMEZONE, DEFAULT_LOCALE, VENDORS, BIZ_KLUB_KEY, BIZ_KLUB_NETWORK_CODES, ROLES, COMMISSION_TYPE } = require("../helpers/consts");
const { sendTelegramDoc, bot } = require("./bot");
const { vEvent, VEVENT_ACCOUNT_CREATED } = require("../event/class");

exports.signUp = catchAsync(async (req, res, next) => {
  const isTelegram = !!req.body?.[P.telegramId];
  const params = [P.firstName, P.lastName, P.email, P.phone];
  if (!isTelegram) { //registration not through telegram
    params.push(P.password);
  }
  const missing = pExCheck(req.body, params);
  if (missing.length != 0) return next(new AppError(400, 'Missing fields.', missing));

  const { firstName, lastName, email, phone } = req.body;

  const filter = [{ 'uid.email': email }, { 'uid.phone': phone }];

  const uidObj = { email, phone };
  if (isTelegram) {
    uidObj[P.telegramId] = req.body[P.telegramId];
    filter.push({ 'uid.telegramId': req.body[P.telegramId] });
  }

  const q = await User.find({ $or: filter });
  if (q.length != 0 && q[0]?.uid?.email == req.body[P.email]) return next(new AppError(400, 'Account with email already exists'));
  else if (q.length != 0 && q[0]?.uid?.phone == req.body[P.phone]) return next(new AppError(400, 'Account with phone already exists'));
  else if (q.length != 0 && isTelegram && q[0]?.uid?.telegramId == req.body[P.telegramId]) return next(new AppError(400, 'Account already linked to telegram'));

  const fields = { uid: uidObj, name: { first: firstName, last: lastName }, testKey: 'tk' + uid(20), liveKey: 'lk' + uid(20) };

  if (!isTelegram) { //registration not through telegram
    fields.password = bcrypt.hashSync(req.body.password, parseInt(process.env.PWD_HASH_LENGTH));
  }

  const q2 = await User.create(fields);
  if (!q2) return next(new AppError(500, 'Could not create account.'));

  res.status(200).json({ status: "success", msg: "Account created." });
  vEvent.emit(VEVENT_ACCOUNT_CREATED, q2._id);
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

  res.status(200).json({ status: 'success', msg: 'Profile fetched', data: q[0] });
});

const singleTopup = catchAsync(async (req, res, next) => {
  const missing = pExCheck(req.body, [P.provider, P.recipient, P.amount]);
  if (missing.length != 0) return next(new AppError(400, 'Missing fields.', missing));

  req.body[P.provider] = req.body[P.provider].toLowerCase();

  // const q = await Service.findOne({ code: 'airtime' }, { _id: 1 });
  const service = await Service.findOne({ code: `vtu-${req.body[P.provider]}` });
  if (!service) return next(new AppError(500, 'Service error'));

  // req.body[P.serviceId] = service._id;
  // req.body[P.commissionType] = COMMISSION_TYPE.RATE;
  // req.body[P.commissionKey] = `vtu-${req.body[P.provider]}`;

  initTransaction2(req, service, next, async (transactionId, options) => {
    const resp = await fetch(`${process.env.VTPASS_API}/pay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': process.env.VTPASS_API_KEY, 'secret-key': process.env.VTPASS_SECRET_KEY },
      body: JSON.stringify({
        request_id: transactionId,
        serviceID: req.body[P.provider],
        amount: req.body[P.amount],
        phone: req.body[P.recipient]
      }),
    });
    if (resp.status != 200) return next(new AppError(500, 'Sorry! we are experiencing a downtime.'));
    const json = await resp.json();
    const { respCode, status, msg, obj } = afterTransaction(transactionId, json, VENDORS.VTPASS);
    res.status(respCode).json({ status, msg });
    updateTransaction(obj, options);
  });
});

const bulkTopup = catchAsync(async (req, res, next) => {
  const q = await Service.findOne({ code: 'airtime' }, { _id: 1 });
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

        await Transaction.create({ userId: req.user.id, transactionId: ref, serviceId: q._id, recipient: arr[i].msisdn, unitPrice: arr[i].price, amount: arr[i].price, totalAmount: arr[i].price, balanceBefore: 0, balanceAfter: 0, tags: req.body?.tags });

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
        const obj = { transactionId: ref, status: json.content.transactions.status, statusDesc: json?.response_description };
        updateTransaction(obj, req.user.id);
      }
    } catch (error) {
      console.log('topup', ':::', 'error', ':::', error);
    }
  }
});

exports.airtime = catchAsync(async (req, res, next) => {
  if (req.body?.list) {
    bulkTopup(req, res, next);
  } else {
    singleTopup(req, res, next);
  }
});

exports.listDataBundles = catchAsync(async (req, res, next) => {
  const missing = pExCheck(req.query, [P.provider]);
  if (missing.length != 0) return next(new AppError(400, 'Missing fields.', missing));

  const type = req.query?.type == 'sme' ? '-sme-' : '-';

  const resp = await fetch(`${process.env.VTPASS_API}/service-variations?serviceID=${req.query[P.provider]}${type}data`, {
    // headers: { 'api-key': process.env.VTPASS_API_KEY, 'secret-key': process.env.VTPASS_SECRET_KEY },
    headers: { 'api-key': process.env.VTPASS_API_KEY, 'public-key': process.env.VTPASS_PUB_KEY },
  });
  const json = await resp.json();
  if (json?.response_description != '000') return next(new AppError(400, 'Cannot list bundles.'));

  res.status(200).json({ status: 'success', msg: 'Bundle listed', data: json?.content?.variations });
});

exports.subData = catchAsync(async (req, res, next) => {
  const missing = pExCheck(req.body, [P.provider, P.recipient, P.amount, P.bundleCode]);
  if (missing.length != 0) return next(new AppError(400, 'Missing fields.', missing));

  const q = await Service.findOne({ code: 'data' }, { _id: 1 });
  if (!q) return next(new AppError(500, 'Service error'));

  req.body[P.serviceId] = q._id;
  req.body[P.provider] = req.body[P.provider].toLowerCase();
  req.body[P.commissionType] = COMMISSION_TYPE.RATE;
  req.body[P.commissionKey] = `data-${req.body[P.provider]}`;

  initTransaction(req, next, async (transactionId) => {
    const resp = await fetch(`${process.env.VTPASS_API}/pay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': process.env.VTPASS_API_KEY, 'secret-key': process.env.VTPASS_SECRET_KEY },
      body: JSON.stringify({
        request_id: transactionId,
        serviceID: `${req.body[P.provider]}-data`,
        billersCode: req.body[P.recipient],
        variation_code: req.body[P.bundleCode],
        amount: req.body[P.amount],
        phone: req.body[P.recipient]
      }),
    });
    const json = await resp.json();
    const { respCode, status, msg, obj } = afterTransaction(transactionId, json, VENDORS.VTPASS);
    res.status(respCode).json({ status, msg });
    updateTransaction(obj, req.user.id);
  });
});

exports.listTVPlans = catchAsync(async (req, res, next) => {
  const missing = pExCheck(req.query, [P.provider]);
  if (missing.length != 0) return next(new AppError(400, 'Missing fields.', missing));

  const resp = await fetch(`${process.env.VTPASS_API}/service-variations?serviceID=${req.query[P.provider]}`, {
    // headers: { 'api-key': process.env.VTPASS_API_KEY, 'secret-key': process.env.VTPASS_SECRET_KEY },
    headers: { 'api-key': process.env.VTPASS_API_KEY, 'public-key': process.env.VTPASS_PUB_KEY },
  });
  const json = await resp.json();
  if (json?.response_description != '000') return next(new AppError(400, 'Cannot list plans.'));

  res.status(200).json({ status: 'success', msg: 'Plans listed', data: json?.content?.variations });
});

exports.verifySmartCardNo = catchAsync(async (req, res, next) => {
  const missing = pExCheck(req.body, [P.provider, P.cardNumber]);
  if (missing.length != 0) return next(new AppError(400, 'Missing fields.', missing));

  // const resp = await fetch(`${process.env.VTPASS_TEST_API}/merchant-verify`, {
  const resp = await fetch(`${process.env.VTPASS_API}/merchant-verify`, {
    method: 'POST',
    // headers: { 'Content-Type': 'application/json', 'api-key': process.env.VTPASS_TEST_API_KEY, 'secret-key': process.env.VTPASS_TEST_SECRET_KEY },
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

  const q = await Service.findOne({ code: 'cable-tv' }, { _id: 1 });
  if (!q) return next(new AppError(500, 'Service error'));

  req.body[P.recipient] = req.body[P.cardNumber];
  req.body[P.serviceId] = q._id;
  req.body[P.commissionType] = COMMISSION_TYPE.RATE;
  req.body[P.provider] = req.body[P.provider].toLowerCase();
  req.body[P.commissionKey] = `${req.body[P.provider]}`;

  initTransaction(req, next, async (transactionId) => {
    // const resp = await fetch(`${process.env.VTPASS_TEST_API}/pay`, {
    const resp = await fetch(`${process.env.VTPASS_API}/pay`, {
      method: 'POST',
      // headers: { 'Content-Type': 'application/json', 'api-key': process.env.VTPASS_TEST_API_KEY, 'secret-key': process.env.VTPASS_TEST_SECRET_KEY },
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

  const q = await Service.findOne({ code: 'cable-tv' }, { _id: 1 });
  if (!q) return next(new AppError(500, 'Service error'));

  req.body[P.recipient] = req.body[P.cardNumber];
  req.body[P.serviceId] = q._id;
  req.body[P.commissionType] = COMMISSION_TYPE.RATE;
  req.body[P.provider] = req.body[P.provider].toLowerCase();
  req.body[P.commissionKey] = `${req.body[P.provider]}`;

  initTransaction(req, next, async (transactionId) => {
    // const resp = await fetch(`${process.env.VTPASS_TEST_API}/pay`, {
    const resp = await fetch(`${process.env.VTPASS_API}/pay`, {
      method: 'POST',
      // headers: { 'Content-Type': 'application/json', 'api-key': process.env.VTPASS_TEST_API_KEY, 'secret-key': process.env.VTPASS_TEST_SECRET_KEY },
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

exports.genAirtimePin = catchAsync(async (req, res, next) => {
  const missing = pExCheck(req.body, [P.provider, P.denomination, P.quantity, P.nameOnCard]);
  if (missing.length != 0) return next(new AppError(400, 'Missing fields.', missing));
  if (isNaN(req.body[P.denomination])) return next(new AppError(400, `${P.denomination} must be a number`));
  if (isNaN(req.body[P.quantity])) return next(new AppError(400, `${P.quantity} must be a number`));

  const DV = { 100: 1, 200: 2, 400: 4, 500: 5, 750: 7.5, 1000: 10, 1500: 15 }; //denominations 

  req.body[P.provider] = req.body[P.provider].toLowerCase();

  const q = await Service.findOne({ code: `${req.body[P.provider]}-epin` }, { _id: 1, templates: 1 });
  if (!q) return next(new AppError(500, 'Service error'));

  req.body[P.serviceId] = q._id;
  req.body[P.recipient] = 'N/A';
  req.body[P.amount] = req.body[P.denomination];
  req.body[P.commissionType] = COMMISSION_TYPE.AMOUNT;
  req.body[P.commissionKey] = `pin-${req.body[P.provider]}-${req.body[P.denomination]}`;
  req.body[P.serviceVariation] = req.body[P.denomination];

  const networkCode = BIZ_KLUB_NETWORK_CODES[req.body[P.provider]];

  initTransaction(req, next, async (transactionId, option) => {
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
      const template = q.templates?.[req.body[P.denomination]];
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

const getVariations = async (vendorCode, next) => {
  const resp = await fetch(`${process.env.VTPASS_API}/service-variations?serviceID=${vendorCode}`, {
    headers: { 'api-key': process.env.VTPASS_API_KEY, 'public-key': process.env.VTPASS_PUB_KEY },
  });
  const json = await resp.json();
  // console.log('getVariations', json);
  if (json?.response_description != '000') return next(new AppError(400, 'Cannot list varations.'));
  return json;
}

exports.getExamPIN = catchAsync(async (req, res, next) => {
  const missing = pExCheck(req.query, [P.type]);
  if (missing.length != 0) return next(new AppError(400, 'Missing fields.', missing));

  const q = await Service.findOne({ code: req.query[P.type] });
  if (!q) return next(new AppError(500, 'Invalid service type'));

  const json = await getVariations(q?.vendorCode, next);

  res.status(200).json({
    status: 'success',
    msg: 'Variations listed',
    data: {
      name: q.title,
      variations: (json?.content?.variations ?? json?.content?.varations)?.map(i => ({ ...i, variation_amount: calcServicePrice(q, { vendorPrice: i.variation_amount }) }))
    }
  });
});

const getVariationAmtFromVTPassJsonResp = (json, variationCode) => {
  const variation = (json?.content?.variations ?? json?.content?.varations)?.filter(i => i?.variation_code == variationCode)[0];
  return variation?.variation_amount;
}

exports.buyExamPIN = catchAsync(async (req, res, next) => {
  const missing = pExCheck(req.body, [P.serviceCode, P.variationCode]);
  if (missing.length != 0) return next(new AppError(400, 'Missing fields.', missing));

  const { format } = req.query;

  const service = await Service.findOne({ code: req.body[P.serviceCode] });
  if (!service) return next(new AppError(500, 'Invalid service type'));

  const json = await getVariations(service?.vendorCode, next);
  const varationAmount = getVariationAmtFromVTPassJsonResp(json, req.body[P.variationCode]);
  if (!varationAmount) return next(new AppError(400, 'Invalid variation code'));
  const amount = calcServicePrice(service, { vendorPrice: varationAmount });

  if (!req.body?.[P.recipient]) {
    const q = await User.findOne({ role: ROLES.admin }, { uid: 1 });
    req.body[P.recipient] = q.uid.phone;
  }

  req.body[P.amount] = amount;
  req.body[P.quantity] = req.body?.[P.quantity] ?? 1;

  initTransaction2(req, service, next, async (transactionId, options) => {
    const resp = await fetch(`${process.env.VTPASS_API}/pay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': process.env.VTPASS_API_KEY, 'secret-key': process.env.VTPASS_SECRET_KEY },
      body: JSON.stringify({
        request_id: transactionId,
        serviceID: service.vendorCode,
        variation_code: req.body[P.variationCode],
        quantity: req.body[P.quantity],
        phone: req.body[P.recipient]
      }),
    });
    const json = await resp.json();
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
        jsonResp = { ...jsonResp, ...obj?.respObj };
      }
    }
    res.status(respCode).json(jsonResp);
  });
});

exports.listTransactions = catchAsync(async (req, res, next) => {
  const { id, recipient, status, tags, field, nameOnCard, format } = req.query;
  const filter = {};
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
    {
      $match: filter
    },
    {
      $limit: 50
    }
  ];
  if (field && field == 'pin') {
    arr.push({ $project: { service: '$serviceId', serviceVariation: 1, unitPrice: 1, quantity: 1, respObj: 1 } });
  } else {
    arr.push({ $project: { service: '$serviceId', serviceVariation: 1, recipient: 1, unitPrice: 1, quantity: 1, discount: 1, totalAmount: 1, status: 1, tags: 1, createdAt: 1, statusDescription: '$statusDesc' } });
  }
  arr.push({
    $project: { _id: 0 }
  });
  const q = await Transaction.aggregate(arr);

  const serviceIDs = new Set(); //values should be strings, or a mixture of numbers and strings
  for (let i = 0; i < q.length; i++) {
    serviceIDs.add(q[i].service.toHexString());
  }

  const q2 = q.length > 0 ? await Service.find({ _id: { $in: Array.from(serviceIDs) } }) : [];

  const template = new Set();
  if (format == 'pdf') { //check if all the transaction has the same print template
    const templates = {} //to hold the list of all the templates in all the service list
    for (let i = 0; i < q2.length; i++) {
      templates[q2[i]._id] = q2[i]?.templates;
    }
    for (let i = 0; i < q.length; i++) {
      if (templates?.[q[i].service]) {
        template.add(templates[q[i].service][q[i]?.serviceVariation]);
      }
    }
    if (template.size != 1) return next(new AppError(400, 'Some transactions can\'t be combined'));
  }

  const services = {};

  const json = { status: 'success', msg: 'Transactions listed' };
  if (field && field == 'pin') {
    for (let i = 0; i < q2.length; i++) {
      services[q2[i]._id] = q2[i]?.provider;
    }

    const pinArr = [], labelObj = {};
    for (let i = 0; i < q.length; i++) {
      const pins = q[i].respObj?.pins, provider = services[q[i].service], denomination = q[i].unitPrice;
      for (let j = 0; j < pins?.length; j++) {
        pinArr.push({ ...pins[j], provider, denomination });
        labelObj[`${provider} N${denomination}`] = (labelObj?.[`${provider} N${denomination}`] ?? 0) + 1; //name on the pdf file
      }
    }

    const user = await User.findOne({ _id: req.user.id }, { uid: 1 });

    const path = await createPDF(user._id, genHTMLTemplate(template.values().next().value, nameOnCard, pinArr));
    let fileName = '';
    for (const key in labelObj) {
      fileName += key + `[${labelObj[key]}] `;
    }
    if (format == 'pdf') {
      fileName += '.pdf';
      sendTelegramDoc(user.uid.telegramId, path, { fileName, deleteOnSent: true });
      json.msg = 'File sent to your telegram';
    } else {
      json.description = fileName;
      json.pins = pinArr;
    }
  } else {
    for (let i = 0; i < q2.length; i++) {
      services[q2[i]._id] = q2[i].title;
    }

    const list = q.map(i => {
      const d = new Date(new Date(i.createdAt).toLocaleString(DEFAULT_LOCALE, { timeZone: TIMEZONE }));
      return { ...i, service: services[i.service], createdAt: d.toLocaleString() };
    });
    json.data = list;
  }
  res.status(200).json(json);
});

exports.balance = catchAsync(async (req, res, next) => {
  const q = await User.findOne({ _id: req.user.id }, { balance: 1, referralBonus: 1 });
  res.status(200).json({ status: 'success', msg: 'Balances fetched', data: { wallet: q?.balance, bonus: q?.referralBonus } });
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

exports.callback = catchAsync(async (req, res, next) => {
  res.status(200).json({ 'response': 'success' });
  const testKey = 'tk' + uid(20);
  const liveKey = 'lk' + uid(20);
  console.log('callback', ':::', req.body, ':::', testKey, ':::', liveKey);
});

exports.ePinsCallback = catchAsync(async (req, res, next) => {
  res.sendStatus(200);
  console.log('ePinsCallback', ':::', req.body);
});

exports.verifyMeterNo = catchAsync(async (req, res, next) => {
  const missing = pExCheck(req.body, [P.provider, P.recipient, P.type]);
  if (missing.length != 0) return next(new AppError(400, 'Missing fields.', missing));

  // const resp = await fetch(`${process.env.VTPASS_TEST_API}/merchant-verify`, {
  const resp = await fetch(`${process.env.VTPASS_API}/merchant-verify`, {
    method: 'POST',
    // headers: { 'Content-Type': 'application/json', 'api-key': process.env.VTPASS_TEST_API_KEY, 'secret-key': process.env.VTPASS_TEST_SECRET_KEY },
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

  // const json = await getVariations(service?.vendorCode, next);
  // const varationAmount = getVariationAmtFromVTPassJsonResp(json, req.body[P.variationCode]);
  // if (!varationAmount) return next(new AppError(400, 'Invalid variation code'));
  // const amount = calcServicePrice(service, { vendorPrice: varationAmount });

  // if (!req.body?.[P.recipient]) {
  //   const q = await User.findOne({ role: ROLES.admin }, { uid: 1 });
  //   req.body[P.recipient] = q.uid.phone;
  // }

  // req.body[P.amount] = amount;
  // req.body[P.quantity] = req.body?.[P.quantity] ?? 1;

  initTransaction2(req, service, next, async (transactionId, option) => {
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
