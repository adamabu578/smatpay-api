const bcrypt = require("bcrypt");
// const nodemailer = require("nodemailer");
const jwt = require("jsonwebtoken");
const fetch = require('node-fetch');
const randtoken = require('rand-token');
const { uid } = require("uid");
const BigNumber = require('bignumber.js');
const puppeteer = require('puppeteer');

const catchAsync = require("../helpers/catchAsync");
const Service = require("../models/service");
const Transaction = require("../models/transaction");
const User = require("../models/user");

const P = require('../helpers/params');
const AppError = require("../helpers/AppError");
const { pExCheck, genRefNo, calcTotal } = require("../helpers/utils");
const { default: mongoose } = require("mongoose");
const { TIMEZONE, DEFAULT_LOCALE, COMMISSION_TYPE, REFUND_STATUS, TRANSACTION_STATUS, VENDORS, EXAM_PIN_TYPES, BIZ_KLUB_KEY } = require("../helpers/consts");
const { sendTelegramDoc } = require("./bot");
const { vEvent, VEVENT_ACCOUNT_CREATED, VEVENT_LOW_BALANCE, VEVENT_TRANSACTION_ERROR, VEVENT_INSUFFICIENT_BALANCE, VEVENT_CHECK_BALANCE } = require("../classes/events");

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

const initTransaction = async (req, onError, onSuccess) => {
  try {
    const missing = pExCheck(req.body, [P.provider, P.recipient, P.amount, P.serviceId, P.commissionType, P.commissionKey]);
    if (missing.length != 0) return onError(new AppError(400, 'Missing fields.', missing));

    const q2 = await User.findOne({ _id: req.user.id }, { 'uid.telegramId': 1, balance: 1, commission: 1 });
    const unitCommission = q2.commission[req.body[P.commissionKey]];

    const qty = req.body?.[P.quantity] ?? 1;
    const amount = req.body[P.amount];

    const [totalAmount, commission] = calcTotal(amount, qty, unitCommission, req.body[P.commissionType]);
    // console.log('totalAmount', totalAmount);

    const balance = q2.balance;
    // console.log('balance', balance);
    const balanceAfter = BigNumber(balance).minus(totalAmount);
    // console.log('balanceAfter', balanceAfter);
    if (balanceAfter < 0) return onError(new AppError(402, 'Insufficient balance'));

    if (req.body?.tags) {
      const q3 = await Transaction.find({ userId: req.user.id, recipient: req.body[P.recipient], tags: req.body.tags });
      if (q3.length != 0) return onError(new AppError(400, 'Duplicate transaction')); //transaction with tags for recipient already exist
    }

    const q4 = await User.updateOne({ _id: req.user.id }, { balance: balanceAfter });
    if (q4?.modifiedCount != 1) return onError(new AppError(500, 'Account error'));

    const transactionId = genRefNo();
    await Transaction.create({ userId: req.user.id, transactionId, serviceId: req.body[P.serviceId], recipient: req.body[P.recipient], unitPrice: amount, quantity: qty, commission, amount, totalAmount, balanceBefore: balance, balanceAfter, tags: req.body?.tags });
    onSuccess(transactionId, { id: q2._id, telegramId: q2.uid.telegramId });
  } catch (error) {
    console.log(error);
    return onError(new AppError(500, 'Transaction initiation error'));
  }
};

const updateTransaction = async (json) => {
  try {
    const obj = {};
    if (json?.status)
      obj.status = json.status;
    if (json?.statusDesc)
      obj.statusDesc = json.statusDesc;
    if (json?.refundStatus)
      obj.refundStatus = json.refundStatu;
    if (json?.respObj)
      obj.respObj = json.respObj;
    if (json?.rawResp)
      obj.rawResp = json?.rawResp;
    await Transaction.updateOne({ transactionId: json.transactionId }, obj);
  } catch (error) {
    console.log('updateTransaction', error);
  }
}

const afterTransaction = (transactionId, json, vendor) => {
  const obj = { transactionId };
  let respCode = 500, status = 'error', msg;
  if (vendor == VENDORS.VTPASS) {
    if (json.code == '000') {
      obj.status = json.content.transactions.status;
      obj.statusDesc = json?.response_description;
      respCode = obj.status == TRANSACTION_STATUS.DELIVERED ? 200 : 201;
      status = 'success';
      msg = obj.status == TRANSACTION_STATUS.DELIVERED ? 'Successful' : 'Request initiated';
    } else if (json.code == '018') { //Low balance
      vEvent.emit(VEVENT_INSUFFICIENT_BALANCE, vendor); //emit low balance event
      obj.status = TRANSACTION_STATUS.FAILED;
      obj.statusDesc = 'Transaction failed';
      obj.refundStatus = REFUND_STATUS.PENDING;
      msg = 'Transaction failed'; //'Pending transaction';
    } else {
      msg = json?.content?.error ?? 'An error occured';
      vEvent.emit(VEVENT_TRANSACTION_ERROR, vendor, msg); //emit transaction error event
      obj.status = TRANSACTION_STATUS.FAILED;
      obj.statusDesc = json?.response_description;
      obj.refundStatus = REFUND_STATUS.PENDING;
    }
  } else if (vendor == VENDORS.BIZKLUB) {
    if (json.statusCode == 200) {
      vEvent.emit(VEVENT_CHECK_BALANCE, vendor, json?.wallet); //emit low balance event
      obj.status = TRANSACTION_STATUS.DELIVERED;
      obj.statusDesc = json.status;
      respCode = 200;
      status = 'success';
      msg = 'Successful';
    } else if (json.statusCode == 204) { //Low balance
      vEvent.emit(VEVENT_INSUFFICIENT_BALANCE, vendor); //emit low balance event
      obj.status = TRANSACTION_STATUS.FAILED;
      obj.statusDesc = 'Transaction failed';
      obj.refundStatus = REFUND_STATUS.PENDING;
      msg = 'Transaction failed'; //'Pending transaction';
    } else {
      msg = json?.message ?? 'An error occured';
      vEvent.emit(VEVENT_TRANSACTION_ERROR, vendor, msg); //emit transaction error event
      obj.status = TRANSACTION_STATUS.FAILED;
      obj.statusDesc = json?.message;
      obj.refundStatus = REFUND_STATUS.PENDING;
    }
  } else if (vendor == VENDORS.EPINS) {
    obj.rawResp = json;
    if (json.code == 101) {
      obj.status = TRANSACTION_STATUS.DELIVERED;
      obj.statusDesc = json.description.status;
      const pinArr = json.description.PIN.split('\n');
      obj.respObj = {
        pins: pinArr.map(i => {
          const item = i.split(',');
          return { pin: item[0], sn: item[1] };
        })
      };
      respCode = 200;
      status = 'success';
      msg = 'Downloading...';
    } else if (json.code == 102) { //Low balance
      vEvent.emit(VEVENT_INSUFFICIENT_BALANCE, vendor); //emit low balance event
      obj.status = TRANSACTION_STATUS.FAILED;
      obj.statusDesc = 'Transaction failed';
      obj.refundStatus = REFUND_STATUS.PENDING;
      msg = 'Transaction failed'; //'Pending transaction';
    } else {
      msg = json?.description ?? 'An error occured';
      vEvent.emit(VEVENT_TRANSACTION_ERROR, vendor, msg); //emit transaction error event
      obj.status = TRANSACTION_STATUS.FAILED;
      obj.statusDesc = json.description;
      obj.refundStatus = REFUND_STATUS.PENDING;
    }
  }
  return { respCode, status, msg, obj };
}

const singleTopup = catchAsync(async (req, res, next) => {
  const missing = pExCheck(req.body, [P.provider, P.recipient, P.amount]);
  if (missing.length != 0) return next(new AppError(400, 'Missing fields.', missing));

  const q = await Service.findOne({ name: 'airtime' }, { _id: 1 });
  if (!q) return next(new AppError(500, 'Service error'));

  req.body[P.serviceId] = q._id;
  req.body[P.provider] = req.body[P.provider].toLowerCase();
  req.body[P.commissionType] = COMMISSION_TYPE.PERCENTAGE;
  req.body[P.commissionKey] = `vtu-${req.body[P.provider]}`;

  initTransaction(req, next, async (transactionId) => {
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
    updateTransaction(obj);
  });
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
        updateTransaction({ transactionId: ref, status: json.content.transactions.status, statusDesc: json?.response_description });
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

  const q = await Service.findOne({ name: 'data' }, { _id: 1 });
  if (!q) return next(new AppError(500, 'Service error'));

  req.body[P.serviceId] = q._id;
  req.body[P.provider] = req.body[P.provider].toLowerCase();
  req.body[P.commissionType] = COMMISSION_TYPE.PERCENTAGE;
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
    updateTransaction(obj);
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

  const q = await Service.findOne({ name: 'cable-tv' }, { _id: 1 });
  if (!q) return next(new AppError(500, 'Service error'));

  req.body[P.recipient] = req.body[P.cardNumber];
  req.body[P.serviceId] = q._id;
  req.body[P.commissionType] = COMMISSION_TYPE.PERCENTAGE;
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
    updateTransaction(obj);
  });
});

exports.tvRenew = catchAsync(async (req, res, next) => {
  const missing = pExCheck(req.body, [P.provider, P.cardNumber, P.amount, P.phone]);
  if (missing.length != 0) return next(new AppError(400, 'Missing fields.', missing));

  const q = await Service.findOne({ name: 'cable-tv' }, { _id: 1 });
  if (!q) return next(new AppError(500, 'Service error'));

  req.body[P.recipient] = req.body[P.cardNumber];
  req.body[P.serviceId] = q._id;
  req.body[P.commissionType] = COMMISSION_TYPE.PERCENTAGE;
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
    updateTransaction(obj);
  });
});

const createPDF = async (uid, nameOnCard, pinsArr) => {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  let html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Document</title>
    <style>
        body {
            margin: 0;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        }

        p,
        span {
            margin: 0;
            font-size: 12px;
        }

        #row {
            display: flex;
            flex-wrap: wrap;
        }

        .card {
            /* width: 25%; */
            width: 220px;
            border-bottom: 0.5px dashed black;
            border-right: 0.5px dashed black;
            padding: 10px;
        }

        .top {
            display: flex;
            justify-content: space-between;
        }

        .info {
            font-size: 10px;
            font-weight: 200;
        }

        span.bold {
            font-weight: 800;
        }
    </style>
</head>
<body>
    <div id="row">`;
  for (let i = 0; i < pinsArr.length; i++) {
    html += `<div class="card">
            <div class="top">
                <span>${nameOnCard}</span>
                <span>${pinsArr[i].provider} &#8358;${pinsArr[i].denomination}</span>
            </div>
            <p>PIN <span class="bold">${pinsArr[i].pin}</span></p>
            <p style="font-size:12px;">S/N ${pinsArr[i].sn}</p>
            <p class="info">Dial *311*PIN#</p>
        </div>`;
  }
  html += `</div>
</body>
</html>`;
  await page.setContent(html);
  const path = `docs/${uid}.pdf`;
  await page.pdf({ path, format: 'A4' });
  await browser.close();
  return path;
}

exports.generatePin = catchAsync(async (req, res, next) => {
  const missing = pExCheck(req.body, [P.provider, P.denomination, P.quantity, P.nameOnCard]);
  if (missing.length != 0) return next(new AppError(400, 'Missing fields.', missing));
  if (isNaN(req.body[P.denomination])) return next(new AppError(400, `${P.denomination} must be a number`));
  if (isNaN(req.body[P.quantity])) return next(new AppError(400, `${P.quantity} must be a number`));

  const DV = { 100: 1, 200: 2, 400: 4, 500: 5, 750: 7.5, 1000: 10, 1500: 15 }; //denominations 
  const networkCodes = { 'mtn': '803', 'airtel': '802', 'glo': '805', '9mobile': '809' };

  const q = await Service.findOne({ name: 'epin' }, { _id: 1 });
  if (!q) return next(new AppError(500, 'Service error'));

  req.body[P.serviceId] = q._id;
  req.body[P.recipient] = 'N/A';
  req.body[P.provider] = req.body[P.provider].toLowerCase();
  req.body[P.amount] = req.body[P.denomination];
  req.body[P.commissionType] = COMMISSION_TYPE.BASE;
  req.body[P.commissionKey] = `pin-${req.body[P.provider]}-${req.body[P.denomination]}`;

  const networkCode = networkCodes[req.body[P.provider]];

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
    updateTransaction(obj);

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
    updateTransaction(obj);
    if (obj.respObj) {
      const pinArr = obj.respObj.pins.map(i => ({ ...i, provider: req.body[P.provider].toUpperCase(), denomination: req.body[P.denomination] }));
      const path = await createPDF(option.id, req.body[P.nameOnCard], pinArr);
      const fileName = `${req.body[P.provider].toUpperCase()} N${req.body[P.denomination]} (${req.body[P.quantity]}).pdf`;
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
    // updateTransaction(obj);
    // if (obj.respObj) {
    //   const path = await createPDF(option.id, req.body[P.provider].toUpperCase(), req.body[P.denomination], req.body[P.nameOnCard], obj.respObj.pins);
    //   const fileName = `${req.body[P.provider].toUpperCase()} N${req.body[P.denomination]} (${req.body[P.quantity]}).pdf`;
    //   sendTelegramDoc(option.telegramId, path, { fileName, deleteOnSent: true });
    // }
  });
});

exports.getExamPIN = catchAsync(async (req, res, next) => {
  const missing = pExCheck(req.query, [P.type]);
  if (missing.length != 0) return next(new AppError(400, 'Missing fields.', missing));

  const types = EXAM_PIN_TYPES;
  if (!types[req.query[P.type]]) return next(new AppError(400, 'Invalid exam type'));

  const resp = await fetch(`${process.env.VTPASS_API}/service-variations?serviceID=${types[req.query[P.type]]}`, {
    // headers: { 'api-key': process.env.VTPASS_API_KEY, 'secret-key': process.env.VTPASS_SECRET_KEY },
    headers: { 'api-key': process.env.VTPASS_API_KEY, 'public-key': process.env.VTPASS_PUB_KEY },
  });
  const json = await resp.json();
  console.log('JSON :::', json);
  if (json?.response_description != '000') return next(new AppError(400, 'Cannot list plans.'));

  res.status(200).json({ status: 'success', msg: 'Plans listed', data: json?.content?.variations });
});

exports.buyExamPIN = catchAsync(async (req, res, next) => {
  const missing = pExCheck(req.body, [P.provider, P.recipient, P.amount, P.bundleCode]);
  if (missing.length != 0) return next(new AppError(400, 'Missing fields.', missing));

  const q = await Service.findOne({ name: 'data' }, { _id: 1 });
  if (!q) return next(new AppError(500, 'Service error'));

  const types = EXAM_PIN_TYPES;

  req.body[P.serviceId] = q._id;
  req.body[P.provider] = req.body[P.provider].toLowerCase();
  req.body[P.commissionType] = COMMISSION_TYPE.PERCENTAGE;
  req.body[P.commissionKey] = `data-${req.body[P.provider]}`;

  initTransaction(req, next, async (transactionId) => {
    const resp = await fetch(`${process.env.VTPASS_API}/pay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': process.env.VTPASS_API_KEY, 'secret-key': process.env.VTPASS_SECRET_KEY },
      body: JSON.stringify({
        request_id: transactionId,
        serviceID: `${req.body[P.provider]}-data`,
        variation_code: req.body[P.bundleCode],
        amount: req.body[P.amount],
        quantity: req.body[P.quantity],
        phone: req.body[P.recipient]
      }),
    });
    const json = await resp.json();
    const { respCode, status, msg, obj } = afterTransaction(transactionId, json, VENDORS.VTPASS);
    res.status(respCode).json({ status, msg });
    updateTransaction(obj);
  });
});

exports.listTransactions = catchAsync(async (req, res, next) => {
  const { transactionId, recipient, status, tags, field, nameOnCard, format } = req.query;
  const filter = {};
  if (transactionId) {
    filter.transactionId = { $in: transactionId.split(',').filter(i => i != '') };
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
  arr.push({
    $project: field && field == 'pin'
      ? {
        service: '$serviceId',
        unitPrice: 1,
        quantity: 1,
        respObj: 1,
      }
      : {
        service: '$serviceId',
        recipient: 1,
        unitPrice: 1,
        quantity: 1,
        discount: 1,
        totalAmount: 1,
        status: 1,
        tags: 1,
        createdAt: 1,
        statusDescription: '$statusDesc'
      }
  });
  arr.push({
    $project: { _id: 0 }
  });
  const q = await Transaction.aggregate(arr);
  const q2 = q.length > 0 ? await Service.find() : [];
  const services = {};

  const json = { status: 'success', msg: 'Transactions listed' };
  if (field && field == 'pin') {
    for (let i = 0; i < q2.length; i++) {
      services[q2[i]._id] = q2[i].provider;
    }

    const pinArr = [], labelObj = {};
    for (let i = 0; i < q.length; i++) {
      const pins = q[i].respObj?.pins, provider = services[q[i].service], denomination = q[i].unitPrice;
      for (let j = 0; j < pins?.length; j++) {
        pinArr.push({ ...pins[j], provider, denomination });
        labelObj[`${provider} N${denomination}`] = (labelObj?.[`${provider} N${denomination}`] ?? 0) + 1;
      }
    }

    const user = await User.findOne({ _id: req.user.id }, { uid: 1 });

    const path = await createPDF(user._id, nameOnCard, pinArr);
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
  const q = await User.findOne({ _id: req.user.id }, { balance: 1 });
  res.status(200).json({ status: 'success', msg: 'Balance fetched', data: q?.balance });
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
