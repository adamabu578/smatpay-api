const fetch = require('node-fetch');
const TelegramBot = require('node-telegram-bot-api');

const catchAsync = require("../helpers/catchAsync");
const User = require("../models/user");
const Session = require("../models/session");
const { capFirstChar } = require('../helpers/utils');

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);
bot.setWebHook(`${process.env.BASE_URL}/bot`);

exports.telegramBot = catchAsync(async (req, res, next) => {
  res.sendStatus(200);
  const q = await User.find({ 'uid.telegramId': req.body.message.from.id });
  let q2;
  if (q.length == 0) {
    q2 = await User.create({ uid: { telegramId: req.body.message.from.id }, name: { first: req.body.message.from?.first_name, last: req.body.message.from?.last_name } });
  } else {
    q2 = q[0];
  }
  if (q2) {
    req.body.message.from._id = q2._id;
    req.body.message.from.key = q2.liveKey;
    bot.processUpdate(req.body);
  }
});

const networks = ['MTN', 'Airtel', 'Glo', '9mobile'];

const airtimeMsg = () => {
  let str = 'Select network';
  for (let i = 0; i < networks.length; i++) {
    str += `\n${i + 1}. ${networks[i]}`;
  }
  return str;
}

const serviceSteps = {
  airtime: [{ msg: airtimeMsg(), key: 'network', value: (index) => networks[parseInt(index) - 1] }, { msg: 'Enter amount', key: 'amount', value: (amount) => amount }, { msg: 'Enter recipient', isEnd: 1, key: 'recipient', value: (reci) => reci }],
  data: [{ msg: airtimeMsg(), key: 'network', value: (index) => networks[parseInt(index) - 1] }, { msg: 'Select bundle', key: 'bundle', value: (amount) => amount }, { msg: 'Enter recipient', key: 'recipient', value: (reci) => reci }],
  electricity: [{ msg: airtimeMsg(), key: 'network', value: (index) => networks[parseInt(index) - 1] }, { msg: 'Select bundle', key: 'bundle', value: (amount) => amount }, { msg: 'Enter recipient', key: 'recipient', value: (reci) => reci }],
  balance: [{ msg: 'Check', key: 'check', value: () => { }, isEnd:1 }],
  account: [{ msg: airtimeMsg(), key: 'network', value: (index) => networks[parseInt(index) - 1] }, { msg: 'Select bundle', key: 'bundle', value: (amount) => amount }, { msg: 'Enter recipient', key: 'recipient', value: (reci) => reci }],
};

const page1 = () => {
  const keys = Object.keys(serviceSteps);
  let str = 'Select option';
  for (let i = 0; i < keys.length; i++) {
    str += `\n${i + 1}. ${capFirstChar(keys[i])}`;
  }
  return str;
}

const closeSession = async (_id) => {
  await Session.updateOne({ _id }, { $set: { isClosed: 1 } });
}

const botProcess = async (msg, q, input) => {
  if (serviceSteps?.[input]) {
    //input exists as a key in service steps, hence it is a start. close any existing session and create a new one
    if (q) closeSession(q._id);
    await Session.create({ user: msg.from._id, options: { service: input } });
    bot.sendMessage(msg.chat.id, serviceSteps?.[input][0].msg);
  } else {
    if (!q) { //A session should have been started by now. display the beginning
      bot.sendMessage(msg.chat.id, page1());
    } else {
      const n = Object.keys(q.options).length;
      const key = serviceSteps?.[q.options.service][n - 1]?.key;
      if (key) {
        await Session.updateOne({ _id: q._id }, { options: { ...q.options, [key]: serviceSteps?.[q.options.service][n - 1].value(input) } });
        if (!serviceSteps?.[q.options.service][n - 1]?.isEnd) {
          bot.sendMessage(msg.chat.id, serviceSteps?.[q.options.service][n].msg);
        } else {
          const q2 = await Session.findOne({ _id: q._id });
          if (q2.options.service == 'airtime') {
            const resp = await fetch(`${process.env.BASE_URL}/topup`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${msg.from.key}` },
              body: JSON.stringify({ provider: q2.options.network, recipient: q2.options.recipient, amount: q2.options.amount }),
            });
            const json = await resp.json();
            bot.sendMessage(msg.chat.id, json?.msg);
          }
        }
      } else {
        bot.sendMessage(msg.chat.id, page1());
      }
    }
  }
}

bot.on('message', async msg => {
  const q = await Session.findOne({ user: msg.from._id, isClosed: 0 });

  if (msg.text == '.') {
    if (q) closeSession(q._id);
    bot.sendMessage(msg.chat.id, page1());
  } else if (!q && !isNaN(msg.text)) {
    const service = Object.keys(serviceSteps)[parseInt(msg.text) - 1];
    botProcess(msg, q, service);
  } else {
    botProcess(msg, q, msg.text);
  }
});
