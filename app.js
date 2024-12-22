require('dotenv').config();
require("./helpers/crons");

const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const cors = require('cors');

const router = require('./routes');
const globalErrorHandler = require("./helpers/errorhandler");

(async () => {
  try {
    await mongoose.connect(process.env.MONGO_URL);
    console.log('DB connected');
  } catch (err) {
    console.log('DB error :::::::', err);
    process.exit(1);
  }
})();

const app = express();

const sessOption = {
  secret: process.env.SESSION_SECRET,
  proxy: process.env.NODE_ENV != 'development',
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV != 'development',
    maxAge: 72 * 60 * 60 * 1000, //3 days
    // domain:'localhost',
  },
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGO_STORE,
    ttl: 14 * 24 * 60 * 60,
    autoRemove: 'native',
    touchAfter: 24 * 3600, //be updated only one time in a period of 24 hours, does not matter how many request's are made (with the exception of those that change something on the session data
  }),
};

if (process.env.NODE_ENV != 'development') {
  sessOption.cookie.sameSite = 'none';
}

const corsOptions = {
  origin: process.env.NODE_ENV == 'development' ? ['http://localhost:5173'] : ['https://v24u.com'],
  credentials: true,
  optionsSuccessStatus: 200, // some legacy browsers (IE11, various SmartTVs) choke on 204
};

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session(sessOption));
app.use(cors(corsOptions));

const prefix = process.env.NODE_ENV != 'development' ? 'v24u' : 'v24u/sandbox';

app.use(`/${prefix}`, router);

app.use(globalErrorHandler);

const port = process.env.NODE_ENV != 'development' ? 3003 : 3004;
app.listen(port, () => {
  console.log(`Running on port: ${port}`);
})

// lsof -i :3000
// kill -9 PROCESS-ID