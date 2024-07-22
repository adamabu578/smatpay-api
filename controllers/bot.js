const fetch = require('node-fetch');
const TelegramBot = require('node-telegram-bot-api');
const fs = require("fs");

const catchAsync = require("../helpers/catchAsync");
const User = require("../models/user");
const Session = require("../models/session");
const { capFirstChar } = require('../helpers/utils');

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);
bot.setWebHook(`${process.env.BASE_URL}/bot`);

exports.telegramBot = catchAsync(async (req, res, next) => {
  res.sendStatus(200);
  bot.processUpdate(req.body);

  // const q = await User.find({ 'uid.telegramId': req.body.message.from.id });
  // let q2;
  // if (q.length == 0) {
  //   q2 = await User.create({ uid: { telegramId: req.body.message.from.id }, name: { first: req.body.message.from?.first_name, last: req.body.message.from?.last_name } });
  // } else {
  //   q2 = q[0];
  // }
  // if (q2) {
  //   req.body.message.from._id = q2._id;
  //   req.body.message.from.key = q2.liveKey;
  //   bot.processUpdate(req.body);
  // }
});

const sendTelegramDoc = async (chatId, filePath, option) => {
  fs.readFile(filePath, async (err, data) => {
    if (data) {
      await bot.sendDocument(chatId, filePath, { caption: option?.caption }, { filename: option?.fileName });
      if (option?.deleteOnSent) {
        fs.unlink(filePath, async (err) => {
          if (err) console.log(err.message)
        });
      }
    }
    if (err) console.log(err.message);
  })
}

exports.sendTelegramDoc = sendTelegramDoc;

const menuActions = {
  createAccount: async (msg, q) => {
    const resp = await fetch(`${process.env.BASE_URL}/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ firstName: msg.from?.first_name, lastName: msg.from?.last_name, email: q.options.email, phone: q.options.phone, telegramId: msg.from.id }),
    });
    const json = await resp.json();
    return json?.msg;
  },
  airtime: async (msg, q) => {
    const resp = await fetch(`${process.env.BASE_URL}/airtime/vtu`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${msg.from.key}` },
      body: JSON.stringify({ provider: q.options.provider, recipient: q.options.recipient, amount: q.options.amount }),
    });
    const json = await resp.json();
    return json?.msg;
  },
  listDataBundle: async (msg, q) => {
    try {
      const resp = await fetch(`${process.env.BASE_URL}/data/bundles?provider=${q?.options?.provider.toLowerCase()}`, {
        headers: { 'Authorization': `Bearer ${msg.from.key}` },
      });
      const json = await resp.json();
      await Session.updateOne({ _id: q._id }, { data: { ...q.data, bundles: json.data } });
      let str = 'Select bundle\n';
      for (let i = 0; i < json.data.length; i++) {
        str += `\n${i + 1}. ${json.data[i].name}`;
      }
      return str;
    } catch (error) {
      return 'An error occured';
    }
  },
  listSMEDataBundle: async (msg, q) => {
    try {
      const resp = await fetch(`${process.env.BASE_URL}/data/bundles?provider=${q?.options?.provider.toLowerCase()}&type=sme`, {
        headers: { 'Authorization': `Bearer ${msg.from.key}` },
      });
      const json = await resp.json();
      console.log('JS', json);
      const bundles = json.data//.filter(i => i.name.toLowerCase().includes('sme'));
      await Session.updateOne({ _id: q._id }, { data: { ...q.data, bundles } });
      let str = 'Select bundle\n';
      for (let i = 0; i < bundles.length; i++) {
        str += `\n${i + 1}. ${bundles[i].name}`;
      }
      return str;
    } catch (error) {
      return 'An error occured';
    }
  },
  data: async (msg, q) => {
    try {
      const bundleOption = parseInt(q.options.bundle);
      if (bundleOption > q?.data?.bundles.length ?? []) {
        return 'Invalid bundle option';
      } else {
        const bundle = q?.data?.bundles[bundleOption - 1];
        const resp = await fetch(`${process.env.BASE_URL}/data`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${msg.from.key}` },
          body: JSON.stringify({ provider: q.options.provider, recipient: q.options.recipient, amount: bundle.variation_amount, bundleCode: bundle.variation_code }),
        });
        const json = await resp.json();
        return json?.msg;
      }
    } catch (error) {
      return 'An error occured';
    }
  },
  checkBalance: async (msg, q) => {
    const resp = await fetch(`${process.env.BASE_URL}/balance`, {
      headers: { 'Authorization': `Bearer ${msg.from.key}` },
    });
    const json = await resp.json();
    return `Your balance is N${json?.data}`;
  },
  topupBalance: async (msg, q) => {
    const resp = await fetch(`${process.env.BASE_URL}/topup/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${msg.from.key}` },
      body: JSON.stringify({ amount: q.options.amount }),
    });
    const json = await resp.json();
    return json?.msg;
  },
  subMenu: async (msg, q) => {
    await botProcess(msg, q, q.options.service);
  },
  verifySmartcardNo: async (msg, q) => {
    try {
      const resp = await fetch(`${process.env.BASE_URL}/tv/card/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${msg.from.key}` },
        body: JSON.stringify({ provider: q?.options?.provider.toLowerCase(), cardNumber: q?.options?.cardNo }),
      });
      const json = await resp.json();
      if (json?.data) {
        await Session.updateOne({ _id: q._id }, { data: { ...q.data, cardInfo: json.data } });
        let str = '';
        str += `Customer Name: ${json.data.Customer_Name}`;
        str += `\nStatus: ${json.data.Status}`;
        str += `\nDue Date: ${json.data.Due_Date}`;
        str += `\nCustomer Number: ${json.data.Customer_Number}`;
        str += `\nCurrent Bouquet: ${json.data.Current_Bouquet}`;
        str += `\nRenewal Amount: ${json.data.Renewal_Amount}`;

        str += `\n\n\nSelect option`;
        str += `\n1. Renew current plan`;
        str += `\n2. Select new plan`;
        return str;
      } else {
        return json?.msg;
      }
    } catch (error) {
      console.log('error :::', error);
      return 'An error occured';
    }
  },
  listTVPlans: async (msg, q) => {
    try {
      const resp = await fetch(`${process.env.BASE_URL}/tv/plans?provider=${q?.options?.provider.toLowerCase()}`, {
        headers: { 'Authorization': `Bearer ${msg.from.key}` },
      });
      const json = await resp.json();
      await Session.updateOne({ _id: q._id }, { data: { ...q.data, plans: json.data } });
      let str = 'Select plan\n';
      for (let i = 0; i < json.data.length; i++) {
        str += `\n${i + 1}. ${json.data[i].name}`;
      }
      return str;
    } catch (error) {
      return 'An error occured';
    }
  },
  tvRenew: async (msg, q) => {
    try {
      const data = q?.data;
      const resp = await fetch(`${process.env.BASE_URL}/tv/renew`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${msg.from.key}` },
        body: JSON.stringify({ provider: q.options.provider, cardNumber: q.options.cardNo, amount: data.cardInfo.Renewal_Amount, phone: q.options.phone }),
      });
      const json = await resp.json();
      return json?.msg;
    } catch (error) {
      return 'An error occured';
    }
  },
  tvSub: async (msg, q) => {
    try {
      const planOption = parseInt(q.options.plan);
      if (planOption > q?.data?.plans.length ?? []) {
        return 'Invalid plan option';
      } else {
        const plan = q?.data?.plans[planOption - 1];
        const resp = await fetch(`${process.env.BASE_URL}/tv/subscribe`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${msg.from.key}` },
          body: JSON.stringify({ provider: q.options.provider, cardNumber: q.options.cardNo, planId: plan.variation_code, amount: plan.variation_amount, phone: q.options.phone }),
        });
        const json = await resp.json();
        return json?.msg;
      }
    } catch (error) {
      return 'An error occured';
    }
  },
  rechargePin: async (msg, q) => {
    try {
      const resp = await fetch(`${process.env.BASE_URL}/airtime/pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${msg.from.key}` },
        body: JSON.stringify({ provider: q.options.provider, denomination: q.options.denomination, quantity: q.options.quantity, nameOnCard: q.options.nameOnCard }),
      });
      if (resp.status == 200) return; //Successful, the file would be sent
      const json = await resp.json();
      return json?.msg;
    } catch (error) {
      return 'An error occured';
    }
  },
};

const networks = ['MTN', 'Airtel', 'Glo', '9mobile'];
const networkValues = { 'MTN': 'MTN', 'Airtel': 'Airtel', 'Glo': 'Glo', '9mobile': 'etisalat' };
const smeOps = ['Glo', '9mobile'];
const tvOps = ['DSTV', 'GOTV', 'Startimes', 'Showmax'];
const epinsOps = { 1: { n: 'Recharge Card PIN', k: '_rechargePin' }, 2: { n: 'WAEC Registration PIN', k: '_waecRegPin' }, 3: { n: 'WAEC Result Checker PIN', k: '_waecCheckPin' } };
const balOps = {
  1: { n: 'Check balance', k: '_checkBalance' }, 2: { n: 'Topup balance (auto)', k: '_topupBalAuto' }
  // , 3: { n: 'Request Topup (manual)', k: '_topupBalManual' }, 4: { n: 'I have made a transfer', k: '_confirmTransfer' } 
};
const acctOps = { 1: { n: 'Balance threshold', k: '_balThreshold' } };
const epinDenominations = {
  1: 100, 2: 200, 3: 500
  //, 4: 1000 
};

const networkMsg = () => {
  let str = 'Select network';
  for (let i = 0; i < networks.length; i++) {
    str += `\n${i + 1}. ${networks[i]}`;
  }
  return str;
}

const epinsOpsMsg = () => {
  let str = 'Select option';
  Object.entries(epinsOps).forEach(([k, v]) => {
    str += `\n${k}. ${v.n}`;
  });
  return str;
}

const epinsOpsK = (opt) => {
  if (isNaN(opt)) return;
  let k;
  for (let key in epinsOps) {
    if (key == parseInt(opt)) {
      k = epinsOps[key].k;
      break
    };
  }
  return k;
}

const balOpsMsg = () => {
  let str = 'Select option';
  Object.entries(balOps).forEach(([k, v]) => {
    str += `\n${k}. ${v.n}`;
  });
  return str;
}

const balOpsK = (opt) => {
  if (isNaN(opt)) return;
  let k;
  for (let key in balOps) {
    if (key == parseInt(opt)) {
      k = balOps[key].k;
      break
    };
  }
  return k;
}

const acctOpsMsg = () => {
  let str = 'Select option';
  Object.entries(acctOps).forEach(([k, v]) => {
    str += `\n${k}. ${v.n}`;
  });
  return str;
}

const acctOpsK = (opt) => {
  if (isNaN(opt)) return;
  let k;
  for (let key in acctOps) {
    if (key == parseInt(opt)) {
      k = acctOps[key].k;
      break
    };
  }
  return k;
}

const smeOpsMsg = () => {
  let str = 'Select network';
  for (let i = 0; i < smeOps.length; i++) {
    str += `\n${i + 1}. ${smeOps[i]}`;
  }
  return str;
}

const tvOpsMsg = () => {
  let str = '';
  for (let i = 0; i < tvOps.length; i++) {
    str += `\n${i + 1}. ${tvOps[i]}`;
  }
  return str;
}

const ePinDenominationMsg = () => {
  let str = 'Select denomination';
  const arr = Object.values(epinDenominations);
  for (let i = 0; i < arr.length; i++) {
    str += `\n${i + 1}. ${arr[i]}`;
  }
  return str;
}

const serviceSteps = {
  'airtime': [{ msg: networkMsg(), key: 'provider', value: (index) => networkValues[networks[parseInt(index) - 1]] }, { msg: 'Enter amount', key: 'amount', value: (amount) => amount }, { msg: 'Enter recipient', key: 'recipient', value: (reci) => reci }, { action: 'airtime', isEnd: true }],
  'data': [{ msg: networkMsg(), key: 'provider', value: (index) => networkValues[networks[parseInt(index) - 1]] }, { action: 'listDataBundle', key: 'bundle', value: (opt) => opt }, { msg: 'Enter recipient', key: 'recipient', value: (input) => input }, { action: 'data', isEnd: true }],
  'SME Data': [{ msg: smeOpsMsg(), key: 'provider', value: (index) => smeOps[parseInt(index) - 1] }, { action: 'listSMEDataBundle', key: 'bundle', value: (opt) => opt }, { msg: 'Enter recipient', key: 'recipient', value: (input) => input }, { action: 'data', isEnd: true }],
  'e-Pin': [{ msg: epinsOpsMsg(), key: 'service', value: (opt) => epinsOpsK(opt) }, { action: 'subMenu' }],
  'electricity': [{ msg: networkMsg(), key: 'provider', value: (index) => networks[parseInt(index) - 1] }, { msg: 'Select bundle', key: 'bundle', value: (amount) => amount }, { msg: 'Enter recipient', key: 'recipient', value: (reci) => reci }],
  'TV Subscription': [{ msg: tvOpsMsg(), key: 'provider', value: (index) => tvOps[parseInt(index) - 1] }, { msg: 'Enter Smartcard Number', key: 'cardNo', value: (input) => input }, { action: 'verifySmartcardNo', key: 'service', value: (opt) => opt == 1 ? '_tvSubRenew' : '_tvSubNewPlan' }, { action: 'subMenu' }],
  'balance': [{ msg: balOpsMsg(), key: 'service', value: (opt) => balOpsK(opt) }, { action: 'subMenu' }],
  'account': [{ msg: acctOpsMsg(), key: 'service', value: (opt) => acctOpsK(opt) }, { action: 'subMenu' }],

  _welcome: [{ msg: 'Welcome\n1. Link an existing account\n2. Create a new account', key: 'service', value: (index) => index == 1 ? '_linkAccount' : '_createAccount' }, { action: 'subMenu' }],
  _checkBalance: [{ action: 'checkBalance', isEnd: true }],
  // _topupBalAuto: [{ msg: 'Enter amount', key: 'amount', value: (input) => input }, { action: 'topupBalance', isEnd: true }],
  _topupBalAuto: [{ msg: 'Sorry! this option is currently not available kindly use the manual option.', isEnd: true }],
  _topupBalManual: [{ msg: 'Kindly make a transfer to this account and confirm the payment with the next option\n\nRoware Limited 2033040743 First Bank.', isEnd: true }],
  _confirmTransfer: [{ msg: 'Request received, your account will be credited immediately the payment is received', isEnd: true }],
  _linkAccount: [{ action: 'linkAccount', isEnd: true }],
  _createAccount: [{ msg: 'Enter email', key: 'email', value: (input) => input }, { msg: 'Enter phone number', key: 'phone', value: (input) => input }, { action: 'createAccount', isEnd: true }],
  _tvSubRenew: [{ msg: 'Enter phone number', key: 'phone', value: (input) => input }, { action: 'tvRenew', isEnd: true }],
  _tvSubNewPlan: [{ action: 'listTVPlans', key: 'plan', value: (opt) => opt }, { msg: 'Enter phone number', key: 'phone', value: (input) => input }, { action: 'tvSub', isEnd: true }],
  _rechargePin: [{ msg: networkMsg(), key: 'provider', value: (index) => networks[parseInt(index) - 1] }, { msg: ePinDenominationMsg(), key: 'denomination', value: (opt) => epinDenominations[opt] }, { msg: 'Enter quantity', key: 'quantity', value: (input) => input }, { msg: 'What name should be on the card?', key: 'nameOnCard', value: (input) => input }, { action: 'rechargePin', isEnd: true }],
  _waecRegPin: [{ isEnd: true }],
  _waecCheckPin: [{ isEnd: true }],
  _balThreshold: [{ action: 'checkBalance', isEnd: true }],
};



const page1 = () => {
  const keys = Object.keys(serviceSteps);
  let index = 1;
  let str = 'Select option';
  for (let key in keys) {
    if (!keys[key].startsWith('_')) {
      str += `\n${index}. ${capFirstChar(keys[key])}`;
      index++;
    }
  }
  return str;
}

const closeSession = async (_id) => {
  await Session.updateOne({ _id }, { $set: { isClosed: 1 } });
}

const botProcess = async (msg, q, serviceKey) => {
  const input = msg.text;
  let menuIndex = 0;
  if (!q) {
    const obj = { options: { service: serviceKey } };
    if (msg.from._id) {
      obj.user = msg.from._id;
    } else {
      obj.telegramId = msg.from.id;
    }
    q = await Session.create(obj);
  } else {
    menuIndex = q.options?.index ?? menuIndex;
  }

  const service = serviceSteps[serviceKey];

  const update = {};

  const prevMenuIndex = menuIndex - 1;
  const prevMenu = service[prevMenuIndex];
  if (prevMenu && prevMenu?.key) {
    update[prevMenu?.key] = prevMenu?.value(input);
  }

  const nextMenuIndex = menuIndex + 1;
  const nextMenu = service[nextMenuIndex];
  if (nextMenu) {
    update.index = nextMenuIndex;
  }

  const menu = service[menuIndex];

  if (menu?.action == 'subMenu') {
    update.index = 0;
  }

  let isClosed = 0;
  if (menu?.isEnd) {
    isClosed = 1;
  }

  if (Object.keys(update).length > 0 || isClosed > 0) {
    await Session.updateOne({ _id: q._id }, { options: { ...q.options, ...update }, isClosed });
  }

  if (menu?.msg) {
    bot.sendMessage(msg.chat.id, menu.msg);
  } else if (menu?.action) {
    const q2 = await Session.findOne({ _id: q._id });
    const resp = await menuActions[menu?.action](msg, q2);
    if (resp)
      bot.sendMessage(msg.chat.id, resp);
  }
}

bot.on('message', async msg => {
  const q = await User.find({ 'uid.telegramId': msg.from.id });

  // let q2;
  // if (q.length == 0) {
  //   q2 = await User.create({ uid: { telegramId: req.body.message.from.id }, name: { first: req.body.message.from?.first_name, last: req.body.message.from?.last_name } });
  // } else {
  //   q2 = q[0];
  // }
  // if (q2) {
  //   req.body.message.from._id = q2._id;
  //   req.body.message.from.key = q2.liveKey;
  //   bot.processUpdate(req.body);
  // }

  const query = { isClosed: 0 };

  if (q.length == 1) { //User already exist
    msg.from._id = q[0]._id;
    msg.from.key = q[0].liveKey;
    query.user = q[0]._id;
  } else {
    query.telegramId = msg.from.id;
  }

  const q2 = await Session.findOne(query);

  if (q.length == 0 && !q2) {
    // msg.from._id = msg.from.id;
    // console.log(q, ':::', q2);
    botProcess(msg, q2, '_welcome');
  } else if (msg.text == '.') {
    if (q2) closeSession(q2._id);
    bot.sendMessage(msg.chat.id, page1());
  } else if (!q2) {
    const input = isNaN(msg.text) ? msg.text : parseInt(msg.text) - 1; //case of selecting a menu with a number (menu index). applicable to page 1 only OR entering a service key directly. e.g airtime
    const serviceKey = Object.keys(serviceSteps)?.[input];
    if (serviceKey) {
      botProcess(msg, q2, serviceKey);
    } else { //other cases, e.g entering a text that does not match any service key
      bot.sendMessage(msg.chat.id, page1());
    }
  } else if (q2) {
    botProcess(msg, q2, q2.options.service);
  }
});
