const randtoken = require('rand-token');
const puppeteer = require('puppeteer');
const { default: BigNumber } = require('bignumber.js');

const { DEFAULT_LOCALE, COMMISSION_TYPE } = require('./consts');
const { REFUND_STATUS, TRANSACTION_STATUS, VENDORS } = require("./consts");
const { vEvent,
    VEVENT_TRANSACTION_ERROR, VEVENT_INSUFFICIENT_BALANCE, VEVENT_CHECK_BALANCE, VEVENT_GIVE_BONUS_IF_APPLICABLE
} = require("../event/class");

const Transaction = require("../models/transaction");
const AppError = require('./AppError');

const P = require('./params');
const User = require('../models/user');

exports.nairaFormatter = Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
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
            from: `"V24u" <${process.env.MAIL_USER}>`, to: email, subject: subject, html: body,
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
        // console.log(error);
    }
};

exports.calcCommission = (unitPrice, qty, defaultUnitCommission, userUnitCommission, commissionType) => {
    // console.log(unitPrice, qty, defaultUnitCommission, userUnitCommission, commissionType);
    const formatter = new Intl.NumberFormat(DEFAULT_LOCALE, { useGrouping: false, roundingMode: 'floor', maximumFractionDigits: 2 });
    let unitAmt, unitComm;
    if (isNaN(unitPrice) || isNaN(qty) || isNaN(defaultUnitCommission) || isNaN(userUnitCommission)) throw new Error('NaN error');
    const unitCommission = BigNumber(defaultUnitCommission).plus(userUnitCommission);
    if (isNaN(unitCommission)) throw new Error('NaN error');

    if (commissionType == COMMISSION_TYPE.AMOUNT) {
        unitAmt = BigNumber(unitPrice).minus(unitCommission);
        unitComm = unitCommission;
    } else if (commissionType == COMMISSION_TYPE.RATE) {
        unitComm = formatter.format((unitPrice * unitCommission) / 100);
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

// exports.initTransaction = async (req, onError, onSuccess) => {
//     try {
//         const missing = this.pExCheck(req.body, [P.provider, P.recipient, P.amount, P.serviceId, P.commissionType, P.commissionKey]);
//         if (missing.length != 0) return onError(new AppError(400, 'Missing fields.', missing));

//         const user = await User.findOne({ _id: req.user.id }, { 'uid.telegramId': 1, balance: 1, commission: 1 });
//         const unitCommission = user.commission[req.body[P.commissionKey]];

//         const qty = req.body?.[P.quantity] ?? 1;
//         const amount = req.body[P.amount];

//         const [totalAmount, commission] = this.calcCommission(amount, qty, unitCommission, req.body[P.commissionType]);
//         // console.log('totalAmount', totalAmount);

//         const balance = user.balance;
//         // console.log('balance', balance);
//         const balanceAfter = BigNumber(balance).minus(totalAmount);
//         // console.log('balanceAfter', balanceAfter);
//         if (balanceAfter < 0) return onError(new AppError(402, 'Insufficient balance'));

//         if (req.body?.tags) {
//             const q3 = await Transaction.find({ userId: req.user.id, recipient: req.body[P.recipient], tags: req.body.tags });
//             if (q3.length != 0) return onError(new AppError(400, 'Duplicate transaction')); //transaction with tags for recipient already exist
//         }

//         const q4 = await User.updateOne({ _id: req.user.id }, { balance: balanceAfter });
//         if (q4?.modifiedCount != 1) return onError(new AppError(500, 'Account error'));

//         const transactionId = this.genRefNo();
//         const fields = { userId: req.user.id, transactionId, serviceId: req.body[P.serviceId], recipient: req.body[P.recipient], unitPrice: amount, quantity: qty, commission, amount, totalAmount, balanceBefore: balance, balanceAfter, tags: req.body?.tags };
//         if (req.body[P.serviceVariation]) {
//             fields[P.serviceVariation] = req.body[P.serviceVariation];
//         }
//         await Transaction.create(fields);
//         onSuccess(transactionId, { id: user._id, telegramId: user.uid.telegramId });
//     } catch (error) {
//         console.log(error);
//         return onError(new AppError(500, 'Transaction initiation error'));
//     }
// };

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

        const commissionType = service.commissionType;
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
            balanceBefore: balance,
            balanceAfter,
            tags: req.body?.tags
        };
        if (req.body[P.serviceVariation]) {
            fields[P.serviceVariation] = req.body[P.serviceVariation];
        }
        await Transaction.create(fields);
        const defaultUnitBonus = service?.unitBonus ?? 0;
        const successOptions = { id: user._id, telegramId: user.uid.telegramId, referrer: user?.referrer, unitPrice: amount, qty, defaultUnitBonus, commissionType };
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

exports.afterTransaction = (transactionId, json, vendor) => {
    const obj = { transactionId };
    let respCode = 500, status = 'error', msg;
    if (vendor == VENDORS.VTPASS) {
        if (json.code == '000') {
            obj.status = json.content.transactions.status;
            obj.statusDesc = json?.response_description;
            if (json?.cards) { //waec result checker
                obj.respObj = {
                    pins: json?.cards.map(i => ({ pin: i.Pin, serial: i.Serial }))
                };
            }
            if (json?.tokens) { //waec registration
                obj.respObj = {
                    pins: json?.tokens.map(i => ({ pin: i }))
                };
            }
            if (json?.Pin) { //utme
                obj.respObj = {
                    pins: [{ pin: this.removeAllWhiteSpace(json?.Pin.split(':')[1]) }]
                };
            }
            if (json?.token) { //electricity
                obj.respObj = {
                    token: this.removeAllWhiteSpace(json?.token.split(':')[1])
                };
            }
            if (json?.purchased_code) { //still electricity. this is just to hold the full value
                obj.respObj = {
                    ...obj?.respObj,
                    purchased_code: json?.purchased_code
                };
            }
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
            msg = json?.content?.error ?? 'Transaction failed';
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
        // obj.rawResp = json;
        if (json.code == 101) {
            obj.status = TRANSACTION_STATUS.DELIVERED;
            obj.statusDesc = json.description?.status ?? 'TRANSACTION SUCCESSFUL';
            if (json.description?.PIN) { //airtime pin
                const pinArr = json.description.PIN.split('\n');
                obj.respObj = {
                    pins: pinArr.map(i => {
                        const item = i.split(',');
                        return { pin: item[0], serial: item[1] };
                    })
                };
            }
            // if (json?.tokens) { //waec registration
            //     obj.respObj = {
            //         pins: json?.tokens.map(i => ({ pin: i }))
            //     };
            // }
            // if (json?.Pin) { //utme
            //     obj.respObj = {
            //         pins: [{ pin: this.removeAllWhiteSpace(json?.Pin.split(':')[1]) }]
            //     };
            // }
            // if (json?.token) { //electricity
            //     obj.respObj = {
            //         token: this.removeAllWhiteSpace(json?.token.split(':')[1])
            //     };
            // }
            if (json?.description) { //this is just to hold the full description field
                obj.respObj = {
                    ...obj?.respObj,
                    description: json?.description
                };
            }
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

exports.genHTMLTemplate = (template, nameOnCard, pinsArr) => {
    let html = '';
    if (template == '100-200-airtime') {
        html = `<!DOCTYPE html>
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
                        width: 244px;
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
                        <p class="info">Dial *311*${pinsArr[i].pin}#</p>
                    </div>`;
        }
        html += `</div>
            </body>
        </html>`;
    } else if (template == '500-1000-airtime') {
        html = `<!DOCTYPE html>
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
                        width: 336px;
                        border-bottom: 0.5px dashed black;
                        border-right: 0.5px dashed black;
                        padding: 10px;
                        padding-left: 50px;
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
                    .vSpace {
                        margin-bottom:4px;
                    }
                </style>
            </head>
            <body>
                <div id="row">`;
        for (let i = 0; i < pinsArr.length; i++) {
            html += `<div class="card">
                        <div class="top vSpace">
                            <span>${nameOnCard}</span>
                            <span>${pinsArr[i].provider} &#8358;${pinsArr[i].denomination}</span>
                        </div>
                        <p class="vSpace">PIN <span class="bold">${pinsArr[i].pin}</span></p>
                        <p style="font-size:12px;" class="vSpace">S/N ${pinsArr[i].sn}</p>
                        <p class="info">Dial *311*${pinsArr[i].pin}#</p>
                    </div>`;
        }
        html += `</div>
            </body>
        </html>`;
    }
    return html;
}