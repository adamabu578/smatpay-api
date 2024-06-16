const cron = require('node-cron');
const fetch = require('node-fetch');
const randtoken = require('rand-token');

const autoRecharge = async () => {
    try {
        
    } catch (err) {
        console.log('helpers :::', 'cronJobs :::', 'keepAlive :::', 'ERROR :::', err.message);
    }
}

// cron.schedule('*/3 * * * * *', autoRecharge); //every 3sec

// exports.autoRecharge = autoRecharge;