const { default: mongoose } = require("mongoose");
const { COMMISSION_TYPE } = require("../helpers/consts");

const serviceSchema = new mongoose.Schema({
    code: {
        type: String,
        required: true,
        unique: true,
    },
    title: {
        type: String,
        required: true,
    },
    // commissionType: {
    //     type: String,
    //     required: true,
    //     default: COMMISSION_TYPE.RATE
    // },
    vendorUnitCommission: {
        type: Number,
        required: true,
        default: 0,
    },
    unitCommission: { //given on purchase
        type: Number,
        required: true,
        default: 0,
    },
    unitCharge: {
        type: Number,
        required: true,
    },
    unitBonus: { //given to referrer
        type: Number,
        required: true,
        default: 0,
    },
    vendorCode: {
        type: String
    },
    // vendorVariationCode: {
    //     type: String
    // },
    // commissionMode: { //should be removed later
    //     type: Number,
    //     required: true,
    //     default: COMMISSION_MODE.PERCENTAGE
    // },
    // templates: { //for service with different template for different variations
    //     type: {},
    // },
    // variationsObj: {
    //     type: {
    //         variation: {
    //             type: {
    //                 printTemplate: {
    //                     type: String,
    //                 },
    //             }
    //         },
    //     },
    // },
});

const Service = mongoose.model('services', serviceSchema);

module.exports = Service;