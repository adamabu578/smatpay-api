const randtoken = require('rand-token');
const { COMMISSION_TYPE, DEFAULT_LOCALE } = require('./consts');
const { default: BigNumber } = require('bignumber.js');
const puppeteer = require('puppeteer');

exports.pExCheck = (reqParams, array) => {
    let resp = [];
    reqParams = JSON.parse(JSON.stringify(reqParams));
    array.forEach(param => {
        if (!reqParams.hasOwnProperty(param) || JSON.stringify(reqParams[param]) == '') {
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

exports.calcTotal = (unitPrice, qty, unitCommission, commissionType) => {
    const formatter = new Intl.NumberFormat(DEFAULT_LOCALE, { useGrouping: false, roundingMode: 'floor', maximumFractionDigits: 2 });
    let unitAmt, unitComm;
    if (isNaN(unitPrice) || isNaN(qty) || isNaN(unitCommission)) throw new Error('NaN error');

    if (commissionType == COMMISSION_TYPE.PRICE) {
        unitAmt = BigNumber(unitPrice).minus(unitCommission);
        unitComm = unitCommission;
    } else if (commissionType == COMMISSION_TYPE.PERCENTAGE) {
        unitComm = formatter.format((unitPrice * unitCommission) / 100);
        unitAmt = BigNumber(unitPrice).minus(unitComm);
    } else {
        throw new Error('Invalid commission');
    }
    return [parseFloat(unitAmt * qty), unitComm * qty]; //[total amount, total commission]
};

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
    if(template == '100-200-airtime') {
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
    } else if(template == '500-1000-airtime') {
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