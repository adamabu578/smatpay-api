const randtoken = require('rand-token');
const puppeteer = require('puppeteer');
const nodemailer = require("nodemailer");
const { default: BigNumber } = require('bignumber.js');

const { COMMISSION_TYPE, NUBAN_PROVIDER } = require('./consts');
const { REFUND_STATUS, TRANSACTION_STATUS } = require("./consts");
const { vEvent, VEVENT_GIVE_BONUS_IF_APPLICABLE } = require("../event/class");

const Transaction = require("../models/transaction");
const AppError = require('./AppError');

const P = require('./params');
const User = require('../models/user');

exports.nairaFormatter = Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
});

exports.currencyFormatter = new Intl.NumberFormat('en-NG', {
    style: 'decimal',
    minimumFractionDigits: 2, // Ensure at least 2 decimal places
    maximumFractionDigits: 2  // Ensure no more than 2 decimal places
});

exports.pExCheck = (reqParams, array) => {
    let resp = [];
    reqParams = JSON.parse(JSON.stringify(reqParams));
    array.forEach(param => {
        if (!reqParams.hasOwnProperty(param) || reqParams[param] == "") {
            resp.push(param);
        }
    });
    return resp;
}

exports.isLive = (secretKey) => {
    return secretKey?.startsWith('lk');
}

exports.capFirstChar = (str) => {
    return str.charAt(0).toUpperCase() + str.slice(1);
};

exports.genRefNo = (str) => {
    const rand = randtoken.generate(8, "01234567899876543210973243409877765463456789");
    const dt = new Intl.DateTimeFormat('en-NG', { timeZone: 'Africa/Lagos', month: '2-digit', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date());
    const d = dt.split(',')[0].split('/');
    const t = dt.split(',')[1].trim().split(':');
    return `${d[2]}${d[1]}${d[0]}${t[0]}${t[1]}${rand}`;
};

exports.calcServicePrice = (service, { vendorPrice, customer }) => {
    return BigNumber.sum(BigNumber.sum(service?.unitPrice ?? 0, vendorPrice ?? 0), service?.unitCharge ?? 0);
}

exports.removeAllWhiteSpace = (str) => {
    return str.replace(/ /g, '');
}

exports.sendEmail = async (email, subject, body, callback) => {
    try {
        const transporter = nodemailer.createTransport({
            host: process.env.MAIL_HOST,
            port: process.env.MAIL_PORT,
            secure: true,
            auth: {
                user: process.env.MAIL_USER,
                pass: process.env.MAIL_PWD,
            },
        });
        const fields = {
            from: `"SmatPay" <${process.env.MAIL_USER}>`, to: email, subject: subject, html: body,
            // dsn: {
            //     id: 'some random message specific id',
            //     return: 'headers',
            //     notify: ['failure', 'delay'],
            //     recipient: 'noreply@qridex.com'
            // }
        };
        if (callback) {
            transporter.sendMail(fields)
                .then(callback);
        } else {
            return await transporter.sendMail(fields);
        }
        // console.log('email sent sucessfully');
    } catch (error) {
        // console.log('email not sent');
        console.log(error);
    }
};

exports.calcCommission = (unitPrice, qty, defaultUnitCommission, userUnitCommission, commissionType) => {
    let unitAmt, unitComm;
    if (isNaN(unitPrice) || isNaN(qty) || isNaN(defaultUnitCommission) || isNaN(userUnitCommission)) throw new Error('NaN error');
    const unitCommission = BigNumber(defaultUnitCommission).plus(userUnitCommission);
    if (isNaN(unitCommission)) throw new Error('NaN error');

    if (commissionType == COMMISSION_TYPE.AMOUNT) {
        unitAmt = BigNumber(unitPrice).minus(unitCommission);
        unitComm = unitCommission;
    } else if (commissionType == COMMISSION_TYPE.PERCENT) {
        unitComm = (BigNumber(unitPrice).multipliedBy(unitCommission)).dividedBy(100);
        unitAmt = BigNumber(unitPrice).minus(unitComm);
    } else {
        throw new Error('Invalid commission');
    }
    return [unitAmt, BigNumber(unitAmt).multipliedBy(qty), BigNumber(unitComm).multipliedBy(qty)]; //[unit amount, total amount, total commission]
};

exports.calcBonus = (unitPrice, qty, defaultUnitBonus, userUnitBonus, commissionType) => {
    // console.log(unitPrice, qty, defaultUnitBonus, userUnitBonus, commissionType);
    let unitBonus;
    if (isNaN(unitPrice) || isNaN(qty) || isNaN(defaultUnitBonus) || isNaN(userUnitBonus)) throw new Error('NaN error');

    if (commissionType == COMMISSION_TYPE.AMOUNT) {
        unitBonus = BigNumber(defaultUnitBonus).plus(userUnitBonus);
    } else if (commissionType == COMMISSION_TYPE.RATE) {
        unitBonus = BigNumber((BigNumber(unitPrice).multipliedBy(defaultUnitBonus)).dividedBy(100)).plus((BigNumber(unitPrice).multipliedBy(userUnitBonus)).dividedBy(100));
    } else {
        throw new Error('Invalid commission');
    }
    return unitBonus * qty;
};

exports.getServiceVariations = async (endpoint) => {
    const resp = await fetch(`${process.env.V24U_API}${endpoint}`, {
        headers: { 'Authorization': `Bearer ${process.env.V24U_SECRET}` },
    });
    // console.log('getServiceVariations ::: resp.status :::', resp.status);
    if (resp.status != 200) return null;
    const json = await resp.json();
    // console.log('getServiceVariations ::: json :::', json);
    return json?.data;
}

exports.getAmtFromVariations = (variations, variationCode) => {
    const variation = variations?.filter(i => i?.variation_code == variationCode)[0];
    return variation?.variation_amount;
}

exports.initTransaction = async (req, service, onError, onSuccess) => {
    try {
        const missing = this.pExCheck(req.body, [P.recipient, P.amount]);
        if (missing.length != 0) return onError(new AppError(400, 'Missing fields.', missing));

        const user = await User.findOne({ _id: req.user.id }, { 'uid.telegramId': 1, balance: 1, commission: 1, referrer: 1 });
        // console.log('user', user);
        const defaultUnitCommission = service?.unitCommission ?? 0;
        const userUnitCommission = user?.commission?.[service?.code] ?? 0;

        const qty = req.body?.[P.quantity] ?? 1;
        const amount = req.body[P.amount];
        // console.log('amount', amount);

        const commissionType = service?.commissionType ?? COMMISSION_TYPE.AMOUNT;
        const [unitAmount, totalAmount, commission] = this.calcCommission(amount, qty, defaultUnitCommission, userUnitCommission, commissionType);
        // console.log('totalAmount', totalAmount);

        const balance = user.balance;
        // console.log('balance', balance);
        const balanceAfter = BigNumber(balance).minus(totalAmount);
        // console.log('balanceAfter', balanceAfter);
        if (balanceAfter < 0) return onError(new AppError(402, 'Insufficient balance'));

        if (req.body?.tags) {
            const q3 = await Transaction.find({ userId: user._id, recipient: req.body[P.recipient], tags: req.body.tags });
            if (q3.length != 0) return onError(new AppError(400, 'Duplicate transaction')); //transaction with tags for recipient already exist
        }

        const q4 = await User.updateOne({ _id: user._id }, { balance: balanceAfter });
        if (q4?.modifiedCount != 1) return onError(new AppError(500, 'Account error'));

        const transactionId = this.genRefNo();
        const fields = {
            userId: user._id,
            transactionId,
            serviceId: service._id,
            recipient: req.body[P.recipient],
            unitPrice: amount,
            quantity: qty,
            commission,
            amount: unitAmount,
            totalAmount,
            tags: req.body?.tags
        };
        if (req.body[P.serviceVariation]) {
            fields[P.serviceVariation] = req.body[P.serviceVariation];
        }
        await Transaction.create(fields);
        const defaultUnitBonus = service?.unitBonus ?? 0;
        const successOptions = { id: user._id, referrer: user?.referrer, unitPrice: amount, qty, defaultUnitBonus, commissionType };
        onSuccess(transactionId, successOptions);
    } catch (error) {
        console.log('initTransaction ::: ERROR :::', error);
        return onError(new AppError(500, 'Transaction initiation error'));
    }
};

exports.updateTransaction = async (json, options) => {
    try {
        const obj = {};
        if (json?.status)
            obj.status = json.status;
        if (json?.statusDesc)
            obj.statusDesc = json.statusDesc;
        if (json?.refundStatus)
            obj.refundStatus = json.refundStatus;
        if (json?.respObj)
            obj.respObj = json.respObj;
        if (json?.rawResp)
            obj.rawResp = json?.rawResp;
        const resp = await Transaction.updateOne({ transactionId: json.transactionId }, obj);
        // console.log(json, ':::', options, ':::', resp)

        //bonus
        if (options?.referrer && json?.status == TRANSACTION_STATUS.DELIVERED && resp?.modifiedCount > 0 && (options?.defaultUnitBonus ?? 0) > 0) {
            const userUnitBonus = 0;
            const bonus = this.calcBonus(options.unitPrice, options.qty, options.defaultUnitBonus, userUnitBonus, options.commissionType);
            vEvent.emit(VEVENT_GIVE_BONUS_IF_APPLICABLE, options.referrer, bonus); //emit new bonus event
        }
    } catch (error) {
        console.log('updateTransaction', error);
    }
}

exports.afterTransaction = (transactionId, statusCode, json) => {
    const obj = { transactionId };
    let respCode = 500, status = 'error', msg;
    if (statusCode == 200 || statusCode == 201) {
        obj.status = TRANSACTION_STATUS.DELIVERED;
        obj.statusDesc = json?.data?.description ?? json?.msg;
        respCode = statusCode;
        status = 'success';
        // msg = obj.status == TRANSACTION_STATUS.DELIVERED ? 'Successful' : 'Request initiated';
        msg = statusCode == 200 ? 'Transaction successful' : 'Transaction initiated';
    } else if (statusCode == 402) { //Payment required
        obj.status = TRANSACTION_STATUS.FAILED;
        obj.statusDesc = 'Transaction failed';
        obj.refundStatus = REFUND_STATUS.PENDING;
        msg = 'Transaction failed'; //'Pending transaction';
    } else if (statusCode == 401 || statusCode == 403) { //Access denied or Forbidden
        obj.status = TRANSACTION_STATUS.FAILED;
        obj.statusDesc = 'Transaction failed';
        obj.refundStatus = REFUND_STATUS.PENDING;
        msg = 'Transaction failed'; //'Pending transaction';
    } else {
        msg = json?.msg ?? 'Transaction failed';
        obj.status = TRANSACTION_STATUS.FAILED;
        obj.statusDesc = json?.description ?? json?.msg;
        obj.refundStatus = REFUND_STATUS.PENDING;
        respCode = statusCode;
    }
    return { respCode, status, msg, obj };
}

exports.createPDF = async (filename, html) => {
    try {
        const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
        const page = await browser.newPage();
        await page.setContent(html);
        const path = `docs/${filename}.pdf`;
        await page.pdf({ path, format: 'A4' });
        await browser.close();
        return path;
    } catch (error) {
        console.log('--------createPDF------------', error, '------------createPDF------------');
    }
}

exports.createPayscribeCustomer = async (email, firstName, lastName, phone) => {
    const resp = await fetch(`${process.env.PAYSCRIBE_API}/customers/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.PAYSCRIBE_PUBLIC_KEY}` },
        body: JSON.stringify({ first_name: firstName, last_name: lastName, phone, email })
    });
    console.log('createPayscribeCustomer ::: resp.status :::', resp.status);
    if (resp.status != 200) return { status: false };
    const json = await resp.json();
    // if (!json.status) return null;
    console.log('createPayscribeCustomer ::: json :::', json);
    return json;
}

exports.createPaystackCustomer = async (email, firstName, lastName, phone) => {
    const resp = await fetch(`${process.env.PAYSTACK_API}/customer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
        body: JSON.stringify({ email, first_name: firstName, last_name: lastName, phone })
    });
    // console.log('createPaystackCustomer ::: resp.status :::', resp.status);
    if (resp.status != 200) return { status: false };
    const json = await resp.json();
    // if (!json.status) return null;
    // console.log('createPaystackCustomer ::: json :::', json);
    return json;
}

exports.validatePaystackCustomer = async (cuid, firstName, lastName, bvn, accountNumber, bankCode, options = { middleName: null, country: 'NG' }) => {
    const body = {
        first_name: firstName,
        last_name: lastName,
        bvn,
        account_number: accountNumber,
        bank_code: bankCode,
        type: 'bank_account',
        country: options.country,
    };
    if (options?.middleName) {
        body.middle_name = options.middleName;
    }

    const resp = await fetch(`${process.env.PAYSTACK_API}/customer/${cuid}/identification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
        body: JSON.stringify(body)
    });
    // console.log('validatePaystackCustomer ::: resp.status :::', resp.status);
    if (resp.status != 200 && resp.status != 202) return { status: 'error' };
    // const json = await resp.json();
    // console.log('validatePaystackCustomer ::: json :::', json);
    return { status: 'success' };
}

exports.createNUBAN = async (customerID, options = { provider: NUBAN_PROVIDER.PAYSCRIBE, preferredBank: process.env.PAYSTACK_VA_PREFERRED_BANK }) => {
    let url, bearer, body = {};
    if (options?.provider == NUBAN_PROVIDER.PAYSCRIBE) {
        url = `${process.env.PAYSCRIBE_API}/collections/virtual-accounts/create`;
        bearer = process.env.PAYSCRIBE_PUBLIC_KEY;
        body = {
            account_type: 'static',
            // currency: 'NGN',
            customer_id: customerID,
            bank: ["9psb"]
        };
    } else if (options?.provider == NUBAN_PROVIDER.PAYSTACK) {
        url = `${process.env.PAYSTACK_API}/dedicated_account`;
        bearer = process.env.PAYSTACK_SECRET_KEY;
        body = {
            customer: customerID,
            preferred_bank: options.preferredBank, // "wema-bank" "titan-paystack"
        };
    }
    const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${bearer}` },
        body: JSON.stringify(body)
    });
    // console.log('createNUBAN ::: resp.status :::', resp.status);
    // if (resp.status != 200) return { status: false };
    const json = await resp.json();
    // console.log('createNUBAN ::: json :::', json);
    if (options?.provider == NUBAN_PROVIDER.PAYSCRIBE && json?.message?.details?.account) {
        return {
            bankName: json?.message?.details?.account[0].bank_name,
            bankId: json?.message?.details?.account[0].bank_code,
            // bankSlug: json?.message?.details?.account[0].,
            accountName: json?.message?.details?.account[0].account_name,
            accountNumber: json?.message?.details?.account[0].account_number,
            currency: json?.message?.details?.account[0].currency,
            type: json?.message?.details?.account[0].account_type,
            provider: options.provider,
        };
    } else if (options?.provider == NUBAN_PROVIDER.PAYSTACK && json?.data) {
        return {
            bankName: json?.data?.bank?.name,
            bankId: json?.data?.bank?.id,
            bankSlug: json?.data?.bank?.slug,
            accountName: json?.data?.account_name,
            accountNumber: json?.data?.account_number,
            currency: json?.data?.currency,
            active: json?.data?.active,
            provider: options.provider,
        }
    }
    return null;
}