const fetch = require('node-fetch');
const TelegramBot = require('node-telegram-bot-api');
const fs = require("fs");

const catchAsync = require("../helpers/catchAsync");
const User = require("../models/user");
const Session = require("../models/session");
const { MENU_STEPS, MENU_OPTION } = require('../helpers/consts');
const { nairaFormatter } = require('../helpers/utils');

const capFirstChar = (str) => {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

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
  subMenu: async (msg, q) => {
    await botProcess(msg, q, q.options.service);
  },
  createAccount: async (msg, session) => {
    console.log('contact :::', msg?.contact);
    const obj = { firstName: msg.from?.first_name, lastName: msg.from?.last_name ?? msg.from?.username, email: session.options.email, phone: session.options.phone, telegramId: msg.from.id };
    const sessions = await Session.find({ $and: [{ telegramId: msg.from.id }, { startParams: { $ne: null } }] }); //look for all sessions with startParams incase the user was referred
    if (sessions.length != 0) { //user was referred
      obj.referralCode = sessions[0].startParams; //first occurence of the user session 
    }
    const resp = await fetch(`${process.env.BASE_URL}/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(obj),
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
    return `Your balances are:\n\nWallet: ${nairaFormatter.format(json?.data.wallet)}\nBonus: ${nairaFormatter.format(json?.data.bonus)}`;
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
  previewExamPIN: async (msg, session) => {
    try {
      const serviceTypeMap = { _waecRegPin: 'waec-registration', _waecCheckPin: 'waec-checker', _utmeRegPin: 'utme', _utmeDEPin: 'utme-de' };
      const resp = await fetch(`${process.env.BASE_URL}/epin/exam/${serviceTypeMap[session.options.service]}`, {
        headers: { 'Authorization': `Bearer ${msg.from.key}` },
      });
      const json = await resp.json();
      let str = json?.msg ?? 'An error occured please try again';
      if (resp.status == 200 && json.status == 'success') {
        // const variations = json.data.variations;
        const pin = json.data;
        await Session.updateOne({ _id: session._id }, { data: { ...session.data, preview: pin } });
        str = `${pin.name}\nPrice: N${pin.amount}\n\n\n${session?.nextMsg ?? 'Enter quantity'}`;
      }
      return str;
    } catch (error) {
      console.log('previewExamPIN ::: ERROR :::', error);
      return 'An error occured';
    }
  },
  verifyProfileCode: async (msg, session) => {
    try {
      const resp = await fetch(`${process.env.BASE_URL}/epin/exam/utme/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${msg.from.key}` },
        body: JSON.stringify({
          profileCode: session.options.profileCode
        }),
      });
      // console.log('verifyProfileCode ::: resp.status :::', resp.status);
      const json = await resp.json();
      // console.log('verifyProfileCode ::: json :::', json);
      if (json?.data) {
        await Session.updateOne({ _id: session._id }, { data: { ...session.data, profile: json.data } });
        let str = '';
        str += `Candidate Name: ${json.data.Customer_Name}`;
        // str += `\nStatus: ${json.data.Status}`;

        str += `\n\nEnter quantity`;
        return str;
      } else {
        // return json?.msg;
        return 'Sorry we could not reach the provider to verify you at the moment please try again'
      }
    } catch (error) {
      console.log('verifyProfileCode ::: ERROR :::', error);
      return 'An error occured';
    }
  },
  buyExamPIN: async (msg, session) => {
    try {
      if (!isNaN(session.options.quantity)) {
        const serviceTypeMap = { _waecRegPin: 'waec-registration', _waecCheckPin: 'waec-checker', _utmeRegPin: 'utme', _utmeDEPin: 'utme-de' };
        const body = {
          serviceCode: serviceTypeMap[session.options.service],
          // variationCode: q?.data?.variations[0].variation_code, 
          quantity: session.options.quantity
        };
        if (session.options?.profileCode) { //case of utme
          body.profileCode = session.options.profileCode;
        }
        const resp = await fetch(`${process.env.BASE_URL}/epin/exam`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${msg.from.key}` },
          body: JSON.stringify(body),
        });
        // console.log('buyExamPIN ::: resp.status :::', resp.status);
        const json = await resp.json();
        // console.log('buyExamPIN ::: json :::', json);
        let str = json?.description ?? json.msg; //If an error occured and no description field
        if (resp.status == 200 && json.status == 'success') {
          for (let i = 0; i < json.pins.length; i++) {
            str += `\n\nPIN: ${json.pins[i].pin}`;
            if (json.pins[i]?.serial) {
              str += `\nSerial: ${json.pins[i].serial}`;
            }
          }
        }
        // console.log(str);
        return str;
      } else {
        return 'Invalid quantity';
      }
    } catch (error) {
      console.log('buyExamPIN ::: ERROR :::', error);
      return 'An error occured';
    }
  },
  airtime2cash: async (msg, session) => {
    try {
      const resp = await fetch(`${process.env.BASE_URL}/airtime/to/cash`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${msg.from.key}` },
        body: JSON.stringify({ provider: session.options.provider, creditSource: session.options.source, amount: session.options.amount }),
      });
      if (resp.status == 200) return; //Successful, the file would be sent
      const json = await resp.json();
      return json?.msg;
    } catch (error) {
      return 'An error occured';
    }
  },
  electVerifyMeterNo: async (msg, q) => {
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
  getReferralLink: async (msg, session) => {
    const resp = await fetch(`${process.env.BASE_URL}/referral/link`, {
      headers: { 'Authorization': `Bearer ${msg.from.key}` },
    });
    const json = await resp.json();
    return json?.data.link;
  },
  getOTL: async (msg, session) => {
    const resp = await fetch(`${process.env.BASE_URL}/otl`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telegramId: msg.from.id }),
    });
    const json = await resp.json();
    if (json?.status == 'success') {
      return `Kindly click on the link or copy and paste in the browser to login on the web.\n\nLink expires in 10 mins\n\n${json?.data?.otl}`;
    }
  },
};

const onboardOps = { 1: { n: 'Already registered (on the mobile or web)? Link account', k: '_linkAccount' }, 2: { n: 'Create a new account', k: '_createAccount' } };
const networks = ['MTN', 'Airtel', 'Glo', '9mobile'];
const smeOps = ['Glo', '9mobile'];
const tvOps = ['DSTV', 'GOTV', 'Startimes', 'Showmax'];
const epinsOps = { 1: { n: 'Recharge Card PIN', k: '_rechargePin' }, 2: { n: 'WAEC Registration PIN', k: '_waecRegPin' }, 3: { n: 'WAEC Result Checker PIN', k: '_waecCheckPin' }, 4: { n: 'JAMB UTME PIN', k: '_utmeRegPin' }, 5: { n: 'JAMB Direct Entry PIN', k: '_utmeDEPin' } };
const electOps = { 1: { n: 'Prepaid', k: '_prepaidElect' }, 2: { n: 'Postpaid', k: '_postpaidElect' } };
const balOps = { 1: { n: 'Check balance', k: '_checkBalance' }, 2: { n: 'Topup balance (instant)', k: '_topupBalInstant' }, 3: { n: 'Topup balance (manual)', k: '_topupBalManual' } };
const acctOps = { 1: { n: 'Balance threshold', k: '_balThreshold' }, 2: { n: 'Referral link', k: '_referralLink' }, 3: { n: 'Get an OTL to login on the web', k: '_getOTL' } };
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

const electOpsMsg = () => {
  let str = 'Select option';
  Object.entries(electOps).forEach(([k, v]) => {
    str += `\n${k}. ${v.n}`;
  });
  return str;
}
const electOpsK = (opt) => {
  if (isNaN(opt)) MENU_OPTION.invalid;;
  let k;
  for (let key in electOps) {
    if (key == parseInt(opt)) {
      k = electOps[key].k;
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
    description: 'Airtime, WAEC, UTME pins',
    steps: [{ msg: epinsOpsMsg(), key: 'service', value: (opt) => epinsOpsK(opt) }, { action: 'subMenu' }],
  },
  {
    key: 'Airtime to Cash [Testing]',
    command: 'airtime2cash',
    description: 'Convert airtime to cash',
    steps: [{ msg: networkMsg(), key: 'provider', value: (opt) => networkOpsK(opt) }, { msg: 'Enter phone number', key: 'source', value: (src) => src }, { msg: 'Enter amount (minimum is ₦1,000)', key: 'amount', value: (amount) => amount }, { action: 'airtime2cash', isEnd: true }],
  },
  {
    key: 'electricity',
    command: 'electricity',
    description: 'Prepaid or post paid electricity',
    steps: [{ msg: electOpsMsg(), key: 'service', value: (opt) => electOpsK(opt) }, { action: 'subMenu' }],
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
    key: 'Contact us',
    command: 'contactus',
    description: 'Contact us',
    steps: [{ msg: 'Whatsapp link\nhttps://wa.me/2348165661377\n\nCall\n+2348165661377, +2349073707533', isEnd: true }],
  },
  {
    key: '_welcome',
    steps: [{ msg: onboardMsg(), key: 'service', value: (opt) => onboardOpsK(opt) }, { action: 'subMenu' }],
  },
  {
    key: '_checkBalance',
    steps: [{ action: 'checkBalance', isEnd: true }],
  },
  {
    key: '_topupBalInstant',
    steps: [{ msg: 'Sorry! this option is currently not available kindly use the manual option.', isEnd: true }],
  },
  {
    key: '_topupBalManual',
    steps: [{ msg: 'Step 1: Make a transfer to this account\nRoware Limited 2033040743 First Bank\n\nStep 2: Send the proof of payment to this link https://wa.me/2348165661377', isEnd: true }],
  },
  {
    key: '_linkAccount',
    steps: [{ action: 'linkAccount', isEnd: true }],
  },
  {
    key: '_createAccount',
    steps: [{ msg: 'Enter email', key: 'email', value: (input) => input }, {
      msg: 'Enter phone number', key: 'phone', value: (input) => input, replyOption: {
        parse_mode: "Markdown",
        reply_markup: JSON.stringify({
          keyboard: [
            // [{ text: "Location", request_location: true }],
            [{ text: "Click to Share Contact", request_contact: true }]
          ],
          one_time_keyboard: true
        })
      }
    }, { action: 'createAccount', isEnd: true }],
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
    steps: [{ action: 'previewExamPIN', key: 'quantity', value: (opt) => opt }, { action: 'buyExamPIN', isEnd: true }],
  },
  {
    key: '_waecCheckPin',
    steps: [{ action: 'previewExamPIN', key: 'quantity', value: (opt) => opt }, { action: 'buyExamPIN', isEnd: true }],
  },
  {
    key: '_utmeRegPin',
    steps: [{ action: 'previewExamPIN', key: 'profileCode', value: (input) => input, nextMsg: 'Enter Profile Code' }, { action: 'verifyProfileCode', key: 'quantity', value: (input) => input }, { action: 'buyExamPIN', isEnd: true }],
  },
  {
    key: '_utmeDEPin',
    steps: [{ action: 'previewExamPIN', key: 'profileCode', value: (input) => input, nextMsg: 'Enter Profile Code' }, { action: 'verifyProfileCode', key: 'quantity', value: (input) => input }, { action: 'buyExamPIN', isEnd: true }],
  },
  {
    key: '_prepaidElect',
    steps: [{ msg: 'Enter Meter Number', key: 'meterNo', value: (input) => input }, { msg: 'Enter Phone Number', key: 'phoneNo', value: (input) => input }, { msg: 'Enter Email Address (optional)\n\nSelect option to skip\n1. Skip', key: 'email', value: (input) => input }, { msg: 'Enter Referral Code (optional)\n\nSelect option to skip\n1. Skip', key: 'refCode', value: (input) => input }, { action: 'electVerifyMeterNo', key: 'details', value: (opt) => opt }, { action: 'electBuyPrepaid', isEnd: true }],
  },
  {
    key: '_postpaidElect',
    steps: [{ msg: 'Enter Account Number', key: 'accountNo', value: (input) => input }, { msg: 'Enter Phone Number', key: 'phoneNo', value: (input) => input }, { action: 'postpaidElect', isEnd: true }],
  },
  {
    key: '_balThreshold',
    steps: [{ action: 'checkBalance', isEnd: true }],
  },
  {
    key: '_referralLink',
    steps: [{ action: 'getReferralLink', isEnd: true }],
  },
  {
    key: '_getOTL',
    steps: [{ action: 'getOTL', isEnd: true, replyOption: { disable_web_page_preview: true, } }],
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
    const obj = { options: { service: serviceKey } }; //menu option
    if (msg.from._id) { //existing user
      obj.user = msg.from._id;
    } else { //new user
      obj.telegramId = msg.from.id;
      if (msg.text?.startsWith('/start')) { //case when parameter is passed
        const words = msg.text.split(' ');
        obj.startParams = words[1];
      }
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
  if (menu?.msg) {
    await bot.sendMessage(msg.chat.id, menu.msg, replyOption); //respond with the message in the menu step
  } else if (menu?.action) {
    const session = await Session.findOne({ _id: q._id });
    if (menu?.nextMsg) {
      session.nextMsg = menu?.nextMsg; //in case there is a specific message that should be displayed next in the response
    }
    const resp = await menuActions[menu?.action](msg, session); //calling the function in the menu step
    if (resp) {//if the step function has a response
      await bot.sendMessage(msg.chat.id, resp, replyOption);
    }
  }
}

bot.on('message', async msg => {
  if (process.env.NODE_ENV == 'development' && msg.from.id != process.env.TELEGRAM_BOT_DEV_USER) {
    bot.sendMessage(msg.chat.id, `Sorry we have moved to ${process.env.TELEGRAM_BOT_LIVE_LINK}`);
  } else {
    const user = await User.find({ 'uid.telegramId': msg.from.id });

    const query = { isClosed: 0 };

    if (user.length == 1) { //User already exist
      msg.from._id = user[0]._id; //add user ID to the from object
      msg.from.key = user[0].liveKey; //add user live key to the from object
      query.user = user[0]._id; //also add user ID to the query object
    } else {
      query.telegramId = msg.from.id; //add user's telegramId to the query object. for first time user yet to be registered
    }

    let q2 = await Session.findOne(query);

    if (user.length == 0 && !q2) {
      console.log('Case 1');
      botProcess(msg, q2, MENU_STEPS._welcome);
    } else if (msg.text == '.' || msg.text == '/start') {
      console.log('Case 2');
      if (q2) closeSession(q2._id);
      if (user.length != 0) {
        bot.sendMessage(msg.chat.id, page1());
      } else {
        botProcess(msg, null, MENU_STEPS._welcome);
      }
    } else if (!q2) {
      console.log('Case 3 :::', msg);
      let serviceKey;
      if (isNaN(msg.text) && msg.text?.startsWith('/')) { //A command is entered e.g /airtime
        serviceKey = menus.filter(i => i.command == msg.text.replace('/', ''))[0]?.key;
      } else if (isNaN(msg.text)) { //A word is entered e.g airtime
        serviceKey = msg.text;
      } else { //A number is entered e.g 1 for airtime
        const keys = Object.keys(mainSteps);
        const opt = parseInt(msg.text);
        if (opt <= keys.length) //ensure user option is not out of range of the keys array
          serviceKey = keys[opt - 1];
      }
      if (mainSteps?.[serviceKey]) { //a service with the key exists in the main menu
        botProcess(msg, q2, serviceKey);
      } else {
        bot.sendMessage(msg.chat.id, page1());
      }
    } else if (q2) {
      console.log('Case 4');
      let serviceKey;
      if (msg.text?.startsWith('/')) { //change of command in the middle of an ongoing session, close the current session and proceed to the new request automatically
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
