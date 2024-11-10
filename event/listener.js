const { vEvent, VEVENT_ACCOUNT_CREATED, VEVENT_CHECK_BALANCE, VEVENT_INSUFFICIENT_BALANCE, VEVENT_TRANSACTION_ERROR, VEVENT_GIVE_BONUS_IF_APPLICABLE } = require('./class');
const User = require('../models/user');
const { bot } = require('../controllers/bot');
const { ROLES } = require('../helpers/consts');
const { calcBonus } = require('../helpers/utils');

vEvent.on(VEVENT_ACCOUNT_CREATED, async (userID) => {
  const q = await User.find({ role: ROLES.admin }, { uid: 1 });
  if (q.length != 0) {
    bot.sendMessage(q[0].uid?.telegramId, 'REPORT ::: Hurray! An account was just created.')
  }
});

vEvent.on(VEVENT_CHECK_BALANCE, async (vendor, balance) => {
  if (isNaN(balance)) return;
  if (balance > 20000) return;
  const q = await User.find({ role: ROLES.admin }, { uid: 1 });
  if (q.length != 0) {
    bot.sendMessage(q[0].uid?.telegramId, `REPORT ::: Oops! Balance is running low on ${vendor}.`)
  }
});

vEvent.on(VEVENT_INSUFFICIENT_BALANCE, async (vendor) => {
  const q = await User.find({ role: ROLES.admin }, { uid: 1 });
  if (q.length != 0) {
    bot.sendMessage(q[0].uid?.telegramId, `REPORT ::: Oops! Insufficient balance on ${vendor}.`)
  }
});

vEvent.on(VEVENT_TRANSACTION_ERROR, async (vendor, msg) => {
  const q = await User.find({ role: ROLES.admin }, { uid: 1 });
  if (q.length != 0) {
    bot.sendMessage(q[0].uid?.telegramId, `REPORT ::: ${vendor} ::: ${msg}`)
  }
});

vEvent.on(VEVENT_GIVE_BONUS_IF_APPLICABLE, async (referrer, bonus) => {
  const q = await User.findByIdAndUpdate(referrer, { $inc: { referralBonus: bonus } }, { fields: { 'uid.telegramId': 1 } });
  if (q?.uid) {
    bot.sendMessage(q?.uid?.telegramId, `₦${bonus} bonus received`);
  }
});