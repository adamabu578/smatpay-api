const AppError = require('../utils/AppError');
const catchAsync = require('../utils/catchAsync')
const jwt = require('jsonwebtoken')
const { ACCOUNT_ROLE } = require('../helpers/utils')

class Auth {
  secret = process.env.AUTH_SECRET;

  constructor(secret) {
    if (secret) {
      this.secret = secret;
    }
  };

  auth = catchAsync(async (req, res, next) => {
    if (req?.session?.token) {
      const token = req.session.token;
      const decoded = jwt.verify(token, this.secret);
      req.user = decoded.payload;
    }
    next();
  });
}

exports.preAuth = (req, res, next) => {
  new Auth(process.env.UNAUTH_SECRET).auth(req, res, () => {
    if (!req?.user) return next(new AppError(401, 'Unauthorized'));
    next();
  });
};

exports.auth = (req, res, next) => {
  new Auth().auth(req, res, () => {
    if (req?.user) {
      next();
    } else {
      res.status(403).json({ status: 'success', msg: 'You are not allowed to do that!' });
      // return next(new AppError(403, 'You are not allowed to do that!'));
    }
  });
};

exports.authAdmin = (req, res, next) => {
  new Auth().auth(req, res, () => {
    if (req?.user?.role === ACCOUNT_ROLE.ADMIN) {
      next();
    } else {
      res.status(403).json({ status: 'success', msg: 'You are not allowed to do that!' });
    }
  });
};

exports.authStudent = (req, res, next) => {
  new Auth().auth(req, res, () => {
    if (req?.user?.role === ACCOUNT_ROLE.USER) {
      next();
    } else {
      res.status(403).json({ status: 'success', msg: 'You are not allowed to do that!' });
    }
  });
};

// module.exports = { preAuth, authAdmin, authStudent };