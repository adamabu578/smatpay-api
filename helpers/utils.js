const randtoken = require('rand-token');

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

exports.isLive = (secretKey)=>{
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