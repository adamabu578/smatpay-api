const { default: mongoose } = require("mongoose");

const otlSchema = new mongoose.Schema({
    uid: {
        type: String,
        required: true,
        unique: true,
    },
    field: {
        type: Object,
        required: true
    },
    isUsed: {
        type: Number,
        default: 0,
    },
    createdAt: {
        type: Date,
        required: true,
    },
}
    // , {
    //     timestamps: { updatedAt: false }
    // }
);

const Otl = mongoose.model('otls', otlSchema);

module.exports = Otl;