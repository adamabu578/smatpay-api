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
    headers: { 'api-key': process.env.VTPASS_API_KEY, 'public-key': process.env.VTPASS_PUB_KEY },
  });
  if (resp.status != 200) return next(new AppError(500, 'Sorry! we are experiencing a downtime.'));
  const json = await resp.json();
  if (json.code != 1) return next(new AppError(500, 'Balance (1) not available.'));
  const bal = json.contents.balance;

  const resp2 = await fetch(`${process.env.EPIN_API}/balance?apikey=${process.env.EPIN_KEY}`);
  if (resp2.status != 200) return next(new AppError(500, 'Balance (2) not available.'));
  const bal2 = await resp2.json();

  const q = await User.find({}, { balance: 1 });
  let userBal = 0;
  for (let i = 0; i < q.length; i++) {
    userBal += q[i].balance;
  }

  res.status(200).json({ status: 'success', msg: 'Balanced fetched', data: { 'Balance (0)': userBal, 'Balance (1)': bal, 'Balance (2)': bal2, 'Balance (1+2)': bal + bal2, 'Balance (1+2)-(0)': (bal + bal2) - userBal } });
});
