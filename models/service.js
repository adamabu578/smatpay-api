const { default: mongoose } = require("mongoose");
const { COMMISSION_TYPE } = require("../helpers/consts");

const serviceSchema = new mongoose.Schema({
    parent: {
        type: mongoose.Types.ObjectId
    },
    code: {
        type: String,
        required: true,
        unique: true,
    },
    title: {
        type: String,
        required: true,
    },
    provider: {
        type: String,
        required: true,
    },
    // costPrice: {
    //     type: Number,
    // },
    unitCharge: {
        type: Number,
        required: true,
    },
    // sellingPrice: {
    //     type: Number,
    //     required: true,
    // },
    vendorCode: {
        type: String
    },
    commissionMode: {
        type: Number,
        required: true,
        default: COMMISSION_TYPE.PERCENTAGE
    },
});

const Service = mongoose.model('services', serviceSchema);

module.exports = Service;