const jwt = require('jsonwebtoken');

const AppError = require('../helpers/AppError');
const catchAsync = require('../helpers/catchAsync');
const { isLive } = require('../helpers/utils');
const User = require('../models/user');

class Auth {
  secret = process.env.AUTH_SECRET;

  constructor(secret) {
    if (secret) {
      this.secret = secret;
    }
  };

  auth = catchAsync(async (req, res, next) => {
    if (req?.headers?.authorization && req?.headers?.authorization.startsWith('Bearer')) {
      const secret = req.headers.authorization.split(' ')[1];
      req.account = { secret };
    }

    if (req?.session?.token) {
      req.user = jwt.verify(req.session.token, this.secret).payload;
    }

    if (req?.account?.secret) {
      // const query = isLive(req.account.secret) ? { liveKey: req.account.secret } : { testKey: req.account.secret };
      const query = { liveKey: req.account.secret };
      // console.log(query);
      const q = await User.find(query);
      if (q?.length == 1) {
        req.user = { ...req?.user, id: q[0]._id.toHexString() };
      }
    }

    next();
  });
}

exports.auth = (req, res, next) => {
  new Auth().auth(req, res, () => {
    if (req?.user) {
      next();
    } else {
      return next(new AppError(403, 'Access denied'));
    }
  });
};