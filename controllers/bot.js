const fetch = require('node-fetch');
const TelegramBot = require('node-telegram-bot-api');
const fs = require("fs");

const catchAsync = require("../helpers/catchAsync");
const User = require("../models/user");
const Session = require("../models/session");
const { capFirstChar } = require('../helpers/utils');
const { MENU_STEPS, MENU_OPTION } = require('../helpers/consts');

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);
bot.setWebHook(`${process.env.BASE_URL}/bot`);

exports.telegramBot = catchAsync(async (req, res, next) => {
  res.sendStatus(200);
  bot.processUpdate(req.body);
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

exports.bot = bot;
exports.sendTelegramDoc = sendTelegramDoc;

const menuActions = {
  createAccount: async (msg, q) => {
    const resp = await fetch(`${process.env.BASE_URL}/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ firstName: msg.from?.first_name, lastName: msg.from?.last_name ?? msg.from?.username, email: q.options.email, phone: q.options.phone, telegramId: msg.from.id }),
    });
    const json = await resp.json();
    return json?.msg;
  },
  subMenu: async (msg, q) => {
    await botProcess(msg, q, q.options.service);
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
      const resp = await fetch(`${process.env.BASE_URL}/epin/airtime`, {
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
  listExamPinVariations: async (msg, q) => {
    try {
      const serviceTypeMap = { _waecRegPin: 'waec-registration', _waecCheckPin: 'waec-checker' };
      const resp = await fetch(`${process.env.BASE_URL}/epin/exam?type=${serviceTypeMap[q.options.service]}`, {
        headers: { 'Authorization': `Bearer ${msg.from.key}` },
      });
      const json = await resp.json();
      const variations = json.data.variations;
      await Session.updateOne({ _id: q._id }, { data: { ...q.data, variations } });
      const str = `${variations[0].name}\nPrice: N${variations[0].variation_amount}\n\n\nEnter quantity`;
      return str;
    } catch (error) {
      return 'An error occured';
    }
  },
  buyExamPIN: async (msg, q) => {
    try {      
      if (!isNaN(q.options.quantity)) {
        const serviceTypeMap = { _waecRegPin: 'waec-registration', _waecCheckPin: 'waec-checker' };
        const resp = await fetch(`${process.env.BASE_URL}/epin/exam`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${msg.from.key}` },
          body: JSON.stringify({ serviceCode: serviceTypeMap[q.options.service], variationCode: q?.data?.variations[0].variation_code, quantity: q.options.quantity }),
        });
        const json = await resp.json();
        let str = json?.description ?? json.msg; //If an error occured and no description field
        if (json.status == 'success') {
          for (let i = 0; i < json.pins.length; i++) {
            str += `\n\nPIN: ${json.pins[i].pin}`;
            if(json.pins[i]?.serial) {
              str += `\nSerial: ${json.pins[i].serial}`;
            }
          }
        }
        console.log(str);
        return str;
      } else {
        return 'Invalid quantity';
      }
    } catch (error) {
      return 'An error occured';
    }
  },
};

const onboardOps = { 1: { n: 'Already registered (on the mobile or web)? Link account', k: '_linkAccount' }, 2: { n: 'Create a new account', k: '_createAccount' } };
const networks = ['MTN', 'Airtel', 'Glo', '9mobile'];
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

const onboardMsg = () => {
  let str = 'Welcome, select option';
  Object.entries(onboardOps).forEach(([k, v]) => {
    str += `\n${k}. ${v.n}`;
  });
  return str;
}
const onboardOpsK = (opt) => {
  if (isNaN(opt)) return MENU_STEPS._welcome;
  let k;
  for (let key in onboardOps) {
    if (key == parseInt(opt)) {
      k = onboardOps[key].k;
      break
    };
  }
  return k ? k : MENU_STEPS._welcome;
}

const networkMsg = () => {
  let str = 'Select network';
  for (let i = 0; i < networks.length; i++) {
    str += `\n${i + 1}. ${networks[i]}`;
  }
  return str;
}
const networkOpsK = (opt) => {
  if (isNaN(opt)) return MENU_OPTION.invalid;
  if (opt > networks.length) return MENU_OPTION.invalid;
  return networks[opt - 1];
}

const smeOpsMsg = () => {
  let str = 'Select network';
  for (let i = 0; i < smeOps.length; i++) {
    str += `\n${i + 1}. ${smeOps[i]}`;
  }
  return str;
}
const smeOpsK = (opt) => {
  if (isNaN(opt)) return MENU_OPTION.invalid;
  if (opt > smeOps.length) return MENU_OPTION.invalid;
  return smeOps[opt - 1];
}

const epinsOpsMsg = () => {
  let str = 'Select option';
  Object.entries(epinsOps).forEach(([k, v]) => {
    str += `\n${k}. ${v.n}`;
  });
  return str;
}
const epinsOpsK = (opt) => {
  if (isNaN(opt)) MENU_OPTION.invalid;;
  let k;
  for (let key in epinsOps) {
    if (key == parseInt(opt)) {
      k = epinsOps[key].k;
      break
    };
  }
  return k;
}

const tvOpsMsg = () => {
  let str = '';
  for (let i = 0; i < tvOps.length; i++) {
    str += `\n${i + 1}. ${tvOps[i]}`;
  }
  return str;
}
const tvOpsK = (opt) => {
  if (isNaN(opt)) return MENU_OPTION.invalid;
  if (opt > tvOps.length) return MENU_OPTION.invalid;
  return tvOps[opt - 1];
}

const ePinDenominationMsg = () => {
  let str = 'Select denomination';
  const arr = Object.values(epinDenominations);
  for (let i = 0; i < arr.length; i++) {
    str += `\n${i + 1}. ${arr[i]}`;
  }
  return str;
}

const balOpsMsg = () => {
  let str = 'Select option';
  Object.entries(balOps).forEach(([k, v]) => {
    str += `\n${k}. ${v.n}`;
  });
  return str;
}
const balOpsK = (opt) => {
  let k = MENU_OPTION.invalid;
  for (let key in balOps) {
    if (key == opt) {
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
  let k = MENU_OPTION.invalid;
  for (let key in acctOps) {
    if (key == opt) {
      k = acctOps[key].k;
      break
    };
  }
  return k;
}

const menus = [
  {
    command: 'start',
    description: 'Start a new session',
  },
  {
    key: 'airtime',
    command: 'airtime',
    description: 'Airtime topup',
    steps: [{ msg: networkMsg(), key: 'provider', value: (opt) => networkOpsK(opt) }, { msg: 'Enter amount', key: 'amount', value: (amount) => amount }, { msg: 'Enter recipient', key: 'recipient', value: (reci) => reci }, { action: 'airtime', isEnd: true }],
  },
  {
    key: 'data',
    command: 'data',
    description: 'Buy internet data',
    steps: [{ msg: networkMsg(), key: 'provider', value: (opt) => networkOpsK(opt) }, { action: 'listDataBundle', key: 'bundle', value: (opt) => opt }, { msg: 'Enter recipient', key: 'recipient', value: (input) => input }, { action: 'data', isEnd: true }],
  },
  {
    key: 'SME Data',
    command: 'smedata',
    description: 'Buy SME data',
    steps: [{ msg: smeOpsMsg(), key: 'provider', value: (opt) => smeOpsK(opt) }, { action: 'listSMEDataBundle', key: 'bundle', value: (opt) => opt }, { msg: 'Enter recipient', key: 'recipient', value: (input) => input }, { action: 'data', isEnd: true }],
  },
  {
    key: 'e-Pin',
    command: 'epin',
    description: 'Generate recharge card pins',
    steps: [{ msg: epinsOpsMsg(), key: 'service', value: (opt) => epinsOpsK(opt) }, { action: 'subMenu' }],
  },
  {
    key: 'electricity',
    command: 'electricity',
    description: 'Prepaid or post paid electricity',
    steps: [{ msg: networkMsg(), key: 'provider', value: (index) => networks[parseInt(index) - 1] }, { msg: 'Select bundle', key: 'bundle', value: (amount) => amount }, { msg: 'Enter recipient', key: 'recipient', value: (reci) => reci }],
  },
  {
    key: 'TV Subscription',
    command: 'tvsubscription',
    description: 'DSTV, GoTV, Startime, ShowMax',
    steps: [{ msg: tvOpsMsg(), key: 'provider', value: (opt) => tvOpsK(opt) }, { msg: 'Enter Smartcard Number', key: 'cardNo', value: (input) => input }, { action: 'verifySmartcardNo', key: 'service', value: (opt) => opt == 1 ? '_tvSubRenew' : '_tvSubNewPlan' }, { action: 'subMenu' }],
  },
  {
    key: 'balance',
    command: 'balance',
    description: 'Account balance options',
    steps: [{ msg: balOpsMsg(), key: 'service', value: (opt) => balOpsK(opt) }, { action: 'subMenu' }],
  },
  {
    key: 'account',
    command: 'account',
    description: 'Account setting options',
    steps: [{ msg: acctOpsMsg(), key: 'service', value: (opt) => acctOpsK(opt) }, { action: 'subMenu' }],
  },
  {
    key: '_welcome',
    steps: [{ msg: onboardMsg(), key: 'service', value: (opt) => onboardOpsK(opt) }, { action: 'subMenu' }],
  },
  {
    key: '_checkBalance',
    steps: [{ action: 'checkBalance', isEnd: true }],
  },
  // {
  //   key: '_topupBalAuto',
  //   steps: [{ msg: 'Enter amount', key: 'amount', value: (input) => input }, { action: 'topupBalance', isEnd: true }],
  // },
  {
    key: '_topupBalAuto',
    steps: [{ msg: 'Sorry! this option is currently not available kindly use the manual option.', isEnd: true }],
  },
  {
    key: '_topupBalManual',
    steps: [{ msg: 'Kindly make a transfer to this account and confirm the payment with the next option\n\nRoware Limited 2033040743 First Bank.', isEnd: true }],
  },
  {
    key: '_confirmTransfer',
    steps: [{ msg: 'Request received, your account will be credited immediately the payment is received', isEnd: true }],
  },
  {
    key: '_linkAccount',
    steps: [{ action: 'linkAccount', isEnd: true }],
  },
  {
    key: '_createAccount',
    steps: [{ msg: 'Enter email', key: 'email', value: (input) => input }, { msg: 'Enter phone number', key: 'phone', value: (input) => input }, { action: 'createAccount', isEnd: true }],
  },
  {
    key: '_tvSubRenew',
    steps: [{ msg: 'Enter phone number', key: 'phone', value: (input) => input }, { action: 'tvRenew', isEnd: true }],
  },
  {
    key: '_tvSubNewPlan',
    steps: [{ action: 'listTVPlans', key: 'plan', value: (opt) => opt }, { msg: 'Enter phone number', key: 'phone', value: (input) => input }, { action: 'tvSub', isEnd: true }],
  },
  {
    key: '_rechargePin',
    steps: [{ msg: networkMsg(), key: 'provider', value: (opt) => networkOpsK(opt) }, { msg: ePinDenominationMsg(), key: 'denomination', value: (opt) => epinDenominations[opt] }, { msg: 'Enter quantity', key: 'quantity', value: (input) => input }, { msg: 'What name should be on the card?', key: 'nameOnCard', value: (input) => input }, { action: 'rechargePin', isEnd: true }],
  },
  {
    key: '_waecRegPin',
    steps: [{ action: 'listExamPinVariations', key: 'quantity', value: (opt) => opt }, { action: 'buyExamPIN', isEnd: true }],
  },
  {
    key: '_waecCheckPin',
    steps: [{ action: 'listExamPinVariations', key: 'quantity', value: (opt) => opt }, { action: 'buyExamPIN', isEnd: true }],
  },
  {
    key: '_balThreshold',
    steps: [{ action: 'checkBalance', isEnd: true }],
  }
];

const commands = menus.filter(i => i?.command && i?.description);
bot.setMyCommands(commands);

const mainSteps = {};
menus.forEach(el => {
  if (el?.key && el?.steps && !el?.key.startsWith('_')) {
    mainSteps[el.key] = el.steps;
  }
});

const subSteps = {};
menus.forEach(el => {
  if (el?.key && el?.steps && el?.key.startsWith('_')) {
    subSteps[el.key] = el.steps;
  }
});

const serviceSteps = { ...mainSteps, ...subSteps };

const page1 = () => {
  const keys = Object.keys(mainSteps);
  let index = 1;
  let str = 'Select option';
  for (let key in keys) {
    str += `\n${index}. ${capFirstChar(keys[key])}`;
    index++;
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

  //previous step
  const prevMenuIndex = menuIndex - 1;
  const prevMenu = service[prevMenuIndex];
  if (prevMenu && prevMenu?.key) {
    if (prevMenu?.value(input) != MENU_OPTION.invalid) {
      update[prevMenu?.key] = prevMenu?.value(input);
    } else {
      menuIndex = prevMenuIndex;
    }
  }

  const menu = service[menuIndex]; //current step

  //next step
  const nextMenuIndex = menuIndex + 1;
  const nextMenu = service[nextMenuIndex];
  if (nextMenu) {
    update.index = nextMenuIndex;
  }
  // }

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

  const replyOption = menu?.replyOption ?? {};
  // const keyboard = Markup.inlineKeyboard([
  //   [
  //     Markup.button.callback('⚡ Status', 'status'),
  //     Markup.button.callback('🙄 Help', 'help'),
  //   ],
  // ]);
  if (menu?.msg) {
    bot.sendMessage(msg.chat.id, menu.msg, replyOption);
  } else if (menu?.action) {
    const q2 = await Session.findOne({ _id: q._id });
    const resp = await menuActions[menu?.action](msg, q2);
    if (resp)
      bot.sendMessage(msg.chat.id, resp, { parse_mode: 'Markdown' });
  }
}

bot.on('message', async msg => {
  if (process.env.NODE_ENV == 'development' && msg.from.id != process.env.TELEGRAM_BOT_DEV_USER) {
    bot.sendMessage(msg.chat.id, `Sorry we have moved to ${process.env.TELEGRAM_BOT_LIVE_LINK}`);
  } else {
    const q = await User.find({ 'uid.telegramId': msg.from.id });

    const query = { isClosed: 0 };

    if (q.length == 1) { //User already exist
      msg.from._id = q[0]._id;
      msg.from.key = q[0].liveKey;
      query.user = q[0]._id;
    } else {
      query.telegramId = msg.from.id;
    }

    let q2 = await Session.findOne(query);

    if (q.length == 0 && !q2) {
      botProcess(msg, q2, MENU_STEPS._welcome);
    } else if (msg.text == '.' || msg.text == '/start') {
      if (q2) closeSession(q2._id);
      if (q.length != 0) {
        bot.sendMessage(msg.chat.id, page1());
      } else {
        botProcess(msg, null, MENU_STEPS._welcome);
      }
    } else if (!q2) {
      let serviceKey;
      if (isNaN(msg.text) && msg.text.startsWith('/')) { //A command is entered e.g /airtime
        serviceKey = menus.filter(i => i.command == msg.text.replace('/', ''))[0]?.key;
      } else if (isNaN(msg.text)) { //A word is entered e.g airtime
        serviceKey = msg.text;
      } else { //A number is entered e.g 1 for airtime
        const keys = Object.keys(mainSteps);
        const opt = parseInt(msg.text);
        if (opt <= keys.length) //ensure user option is not out of range of the keys array
          serviceKey = keys[opt - 1];
      }
      if (mainSteps?.[serviceKey]) {
        botProcess(msg, q2, serviceKey);
      } else {
        bot.sendMessage(msg.chat.id, page1());
      }
    } else if (q2) {
      let serviceKey;
      if (msg.text.startsWith('/')) { //change of command in the middle of an ongoing session, close the current session and proceed to the new request automatically
        serviceKey = menus.filter(i => i.command == msg.text.replace('/', ''))[0]?.key;
        if (mainSteps?.[serviceKey]) {
          closeSession(q2._id);
          q2 = null;
        }
      }

      serviceKey = serviceKey ?? q2.options.service;

      botProcess(msg, q2, serviceKey);
    }
  }
});

// replyOption: {
//   reply_markup: {
//     inline_keyboard: [
//       [
//         // {
//         //   text: "Yes",
//         //   callback_data: "btn_yes"
//         // },
//         {
//           text: "Use my phone number",
//           callback_data: "request_contact",
//           request_contact: true,
//         },
//       ]
//     ]
//   },
// },