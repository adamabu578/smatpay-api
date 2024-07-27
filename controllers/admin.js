const catchAsync = require("../helpers/catchAsync");
const { VENDORS, ROLES } = require("../helpers/consts");

const P = require('../helpers/params');
const { vEvent, VEVENT_ACCOUNT_CREATED, VEVENT_LOW_BALANCE } = require("../classes/events");
const User = require("../models/user");
const { bot } = require("./bot");
const fetch = require("node-fetch");
const AppError = require("../helpers/AppError");

vEvent.on(VEVENT_ACCOUNT_CREATED, async (userID) => {
  const q = await User.find({ role: ROLES.admin }, { uid: 1 });
  if (q.length != 0) {
    bot.sendMessage(q[0].uid?.telegramId, 'Hurray! An account was just created.')
  }
});

vEvent.on(VEVENT_LOW_BALANCE, async (vendor) => {
  const q = await User.find({ role: ROLES.admin }, { uid: 1 });
  if (q.length != 0) {
    bot.sendMessage(q[0].uid?.telegramId, `Oops! Balance is running low on ${vendor}.`)
  }
});

exports.freeBalance = catchAsync(async (req, res, next) => {
  const resp = await fetch(`${process.env.VTPASS_API}/balance`, {
    headers: { 'api-key': process.env.VTPASS_API_KEY, 'secret-key': process.env.VTPASS_SECRET_KEY },
  });
  // if (resp.status != 200) return next(new AppError(500, 'Sorry! we are experiencing a downtime.'));
  const json = await resp.json();
  console.log('JSON :::', json);

  const resp2 = await fetch(`${process.env.EPIN_API}/balance?apikey=${process.env.EPIN_KEY}`
  //   , {
  //   body: JSON.stringify({
  //     apikey: process.env.EPIN_KEY,
  //     service: "epin",
  //     network: req.body[P.provider],
  //     pinDenomination: DV[req.body[P.denomination]],
  //     pinQuantity: req.body[P.quantity],
  //     ref: transactionId
  //   }),
  // }
);
  if (resp2.status != 200) return next(new AppError(500, 'Sorry! we are experiencing a downtime.'));
  const json2 = await resp2.json();
  console.log('JSON :::', json2);
});
