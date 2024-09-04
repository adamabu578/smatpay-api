const Transaction = require("../models/transaction");
const { REFUND_STATUS, TRANSACTION_STATUS, VENDORS } = require("./consts");
const { vEvent, VEVENT_TRANSACTION_ERROR, VEVENT_INSUFFICIENT_BALANCE, VEVENT_CHECK_BALANCE } = require("../classes/events");
const { removeAllWhiteSpace } = require("./utils");

exports.updateTransaction = async (json) => {
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
        await Transaction.updateOne({ transactionId: json.transactionId }, obj);
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
            if (json?.token) { //electricity
                obj.respObj = {
                    token: removeAllWhiteSpace(json?.token.split(':')[1])
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
        // obj.rawResp = json;
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