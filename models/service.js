const { default: mongoose } = require("mongoose");

const serviceSchema = new mongoose.Schema({
    parent: {
        type: mongoose.Types.ObjectId
    },
    name: {
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
});

const Service = mongoose.model('services', serviceSchema);

module.exports = Service;