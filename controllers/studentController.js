const fetch = require('node-fetch');

const catchAsync = require("../utils/catchAsync");

exports.fetchExams = catchAsync(async (req, res, next) => {
  const exams = await fetch(`${process.env.PQ_API_URL}/pq/exams?logo=true`, { headers: { Authorization: `Bearer ${process.env.PQ_API_SECRET}` } });
  // console.log('exams.status', exams.status);

  if (exams.status != 200) return res.status(500).json({ status: 'error', msg: 'Unable to fetch exams' })

  const q = await exams.json();
  // console.log('exams.json', q);
  if (q.status != 'success') return res.status(500).json({ status: 'error', msg: 'Unable to fetch exams' });
  res.status(200).json({ status: 'success', msg: 'Exams fetched', data: q.data });
})

exports.fetchSubjects = catchAsync(async (req, res, next) => {
  const subjects = await fetch(`${process.env.PQ_API_URL}/pq/subjects`, { headers: { Authorization: `Bearer ${process.env.PQ_API_SECRET}` } })
  if (subjects.status != 200) return res.status(500).json({ status: 'error', msg: 'Unable to fetch questions' })

  const q = await subjects.json();

  if (q.status != 'success') return res.status(500).json({ status: 'error', msg: 'Unable to fetch subjects' })

  res.status(200).json({ status: 'success', msg: 'Subjects fetched', data: q.data })
})

exports.listYears = catchAsync(async (req, res, next) => {
  const years = await fetch(`${process.env.PQ_API_URL}/pq/years`, { headers: { Authorization: `Bearer ${process.env.PQ_API_SECRET}` } })
  if (years.status != 200) return res.status(500).json({ status: 'error', msg: 'Unable to list years' })

  const q = await years.json();
  if (q.status != 'success') return res.status(500).json({ status: 'error', msg: 'Unable to fetch years' });
  res.status(200).json({ status: 'success', msg: 'Years fetched', data: q.data });

})

exports.listSchools = catchAsync(async (req, res, next) => {
  const schools = await fetch(`${process.env.PQ_API_URL}/pq/schools`, { headers: { Authorization: `Bearer ${process.env.PQ_API_SECRET}` } });
  if (schools.status != 200) return res.status(500).json({ status: 'error', msg: 'Unable to list schools' })

  const q = await schools.json()
  if (q.status != 'success') return res.status(500).json({ status: 'error', msg: 'Unable to fetch schools' })
  res.status(200).json({ status: 'success', msg: 'Schools fetched', data: q.data })

})

exports.getQuestions = catchAsync(async (req, res, next) => {
  const paramKeys = [];

  if (req.query) {
    Object.keys(req.query).map(key => {
      paramKeys.push(key + '=' + req.query[key]);
      return paramKeys;
    });
  }

  const queryString = paramKeys?.join('&') ?? "";
  const questions = await fetch(`${process.env.PQ_API_URL}/pq/questions?${queryString}`, { headers: { Authorization: `Bearer ${process.env.PQ_API_SECRET}` } })

  if (questions.status != 200) return res.status(500).json({ status: 'error', msg: 'Unable to list questions' })

  const q = await questions.json()
  if (q.status != 'success') return res.status(500).json({ status: 'error', msg: 'Unable to fetch questions' })
  res.status(200).json({ status: 'success', msg: 'Questions fetched', data: q.data });
})