const jwt = require('jsonwebtoken');

const AppError = require('../helpers/AppError');
const catchAsync = require('../helpers/catchAsync');
const { isLive } = require('../helpers/utils');
const User = require('../models/user');
const { ROLES } = require('../helpers/consts');

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
      const query = process.env.NODE_ENV != 'development' ? { liveKey: req.account.secret } : { testKey: req.account.secret };
      // console.log(query);
      const q = await User.find(query, { _id: 1, role: 1 });
      if (q?.length == 1) {
        req.user = { ...req?.user, id: q[0]._id.toHexString(), role: q[0]?.role };
      }
    }

    next();
  });
}

// exports.preAuth = (req, res, next) => {
//   new Auth(process.env.PRE_AUTH_SECRET).auth(req, res, () => {
//     if (req?.user) {
//       next();
//     } else {
//       return next(new AppError(403, 'Access denied'));
//     }
//   });
// };

exports.auth = (req, res, next) => {
  new Auth().auth(req, res, () => {
    if (req?.user) {
      next();
    } else {
      return next(new AppError(403, 'Access denied'));
    }
  });
};

exports.authAdmin = (req, res, next) => {
  new Auth().auth(req, res, () => {
    if (req?.user?.role == ROLES.admin) {
      next();
    } else {
      return next(new AppError(403, 'Access denied'));
    }
  });
};