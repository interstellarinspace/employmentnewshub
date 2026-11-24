// Sample posts so a fresh install doesn't look empty. They are fictional:
// delete them from the admin panel before going live, or set SEED_SAMPLE=false.
const { posts } = require('./db');

const d = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const LINKS = [
  { label: 'Apply Online', url: 'https://example.com/apply' },
  { label: 'Official Notification (PDF)', url: 'https://example.com/notification.pdf' },
  { label: 'Official Website', url: 'https://example.com' },
];

const SAMPLES = [
  { type: 'job', title: '[Sample] State Police Constable Recruitment 2026 – 1,250 Posts', organization: 'Sample State Police Recruitment Board',
    category: 'Police Jobs', state: 'Karnataka', qualification: '12th Pass', vacancies: 1250, salary: '₹21,400 – ₹42,000 per month',
    summary: 'Applications are invited from eligible candidates for the post of Police Constable (Civil). Apply online before the last date.',
    fees: 'General / OBC: ₹400\nSC / ST: ₹200\nPayment mode: Online (UPI, card, net banking)',
    age_limit: 'Minimum age: 18 years\nMaximum age: 25 years\nAge relaxation: As per government rules',
    eligibility: '- Passed 12th (PUC) from a recognised board\n- Must meet physical standards given in the notification',
    selection: '- Written exam\n- Physical endurance and measurement test\n- Document verification\n- Medical exam',
    how_to_apply: '- Visit the official website\n- Register with your mobile number and email\n- Fill the application form and upload photo and signature\n- Pay the fee and print the confirmation page',
    start_date: d(-5), last_date: d(20), exam_date: d(60), featured: true },
  { type: 'job', title: '[Sample] Bank Clerk (Customer Service Associate) 2026 – 4,000 Posts', organization: 'Sample National Banking Personnel Institute',
    category: 'Bank Jobs', state: 'All India', qualification: 'Graduate', vacancies: 4000, salary: '₹24,000 – ₹64,500 per month',
    summary: 'Common recruitment process for clerical cadre posts in participating public sector banks.',
    fees: 'General / OBC / EWS: ₹850\nSC / ST / PwBD: ₹175', age_limit: 'Minimum age: 20 years\nMaximum age: 28 years',
    eligibility: 'A degree (graduation) in any discipline from a recognised university. Computer literacy is required.',
    selection: '- Preliminary exam\n- Main exam\n- Language proficiency test', how_to_apply: 'Apply online through the official website between the start and last dates.',
    start_date: d(-2), last_date: d(4), exam_date: d(45), featured: true },
  { type: 'job', title: '[Sample] Railway Assistant Loco Pilot Recruitment 2026 – 5,600 Posts', organization: 'Sample Railway Recruitment Cell',
    category: 'Railway Jobs', state: 'All India', qualification: 'ITI,Diploma,B.Tech/B.E', vacancies: 5600, salary: 'Level 2 – ₹19,900 initial pay',
    summary: 'Recruitment for Assistant Loco Pilot posts across zonal railways.', fees: 'General / OBC: ₹500\nSC / ST / Women: ₹250',
    age_limit: 'Minimum age: 18 years\nMaximum age: 30 years', eligibility: '10th pass plus ITI in a relevant trade, or Diploma / Degree in Engineering.',
    selection: '- Computer based test (Stage 1)\n- Computer based test (Stage 2)\n- Aptitude test\n- Document verification',
    start_date: d(-10), last_date: d(12) },
  { type: 'job', title: '[Sample] Govt School Teacher (TGT/PGT) Recruitment 2026 – 980 Posts', organization: 'Sample Education Services Board',
    category: 'Teaching Jobs', state: 'Delhi', qualification: 'Graduate,Post Graduate,B.Ed', vacancies: 980, salary: '₹44,900 – ₹1,42,400 per month',
    summary: 'Recruitment of Trained Graduate Teachers and Post Graduate Teachers in government schools.', fees: 'General: ₹100\nSC / ST / Women: Nil',
    age_limit: 'TGT: Up to 32 years\nPGT: Up to 36 years', start_date: d(-1), last_date: d(28) },
  { type: 'job', title: '[Sample] Multi Tasking Staff (MTS) Recruitment 2026 – 8,300 Posts', organization: 'Sample Staff Selection Board',
    category: 'SSC Jobs', state: 'All India', qualification: '10th Pass', vacancies: 8300, salary: 'Pay Level 1 – ₹18,000 to ₹56,900',
    summary: 'Recruitment of Multi Tasking (Non-Technical) Staff and Havaldar posts.', fees: 'General / OBC: ₹100\nSC / ST / Women / PwBD: Nil',
    age_limit: '18 – 25 years (MTS)\n18 – 27 years (Havaldar)', start_date: d(-15), last_date: d(2), exam_date: d(70) },
  { type: 'job', title: '[Sample] Junior Engineer (Civil/Electrical) Recruitment 2026 – 320 Posts', organization: 'Sample Power Generation Corporation Ltd',
    category: 'PSU Jobs', state: 'Maharashtra', qualification: 'Diploma,B.Tech/B.E', vacancies: 320, salary: '₹35,000 – ₹1,10,000',
    summary: 'Recruitment of Junior Engineers through a written test.', start_date: d(0), last_date: d(25) },
  { type: 'job', title: '[Sample] Staff Nurse Recruitment 2026 – 610 Posts', organization: 'Sample State Health Services',
    category: 'Medical Jobs', state: 'Tamil Nadu', qualification: 'Nursing', vacancies: 610, salary: '₹36,400 per month',
    summary: 'Recruitment of Staff Nurse on a regular basis in government hospitals.', start_date: d(-3), last_date: d(15) },
  { type: 'job', title: '[Sample] Software Developer Trainee – Private IT Company (Walk-in)', organization: 'Sample Tech Solutions Pvt Ltd',
    category: 'Private Jobs', state: 'Telangana', qualification: 'B.Tech/B.E,Graduate', vacancies: 150, salary: '₹3.5 – ₹5 LPA',
    summary: 'Freshers walk-in drive for software developer trainees.', last_date: d(9) },
  { type: 'result', title: '[Sample] Combined Graduate Level Exam 2025 – Final Result Declared', organization: 'Sample Staff Selection Board', category: 'SSC Jobs', state: 'All India',
    summary: 'The final result has been published. Candidates can check roll numbers in the PDF list.',
    how_to_apply: '- Open the official website\n- Click on "Results"\n- Open the result PDF and search for your roll number using Ctrl+F' },
  { type: 'result', title: '[Sample] State Police Sub-Inspector Written Exam Result 2026', organization: 'Sample State Police Recruitment Board', category: 'Police Jobs', state: 'Uttar Pradesh' },
  { type: 'result', title: '[Sample] Bank PO Mains Result 2026', organization: 'Sample National Banking Personnel Institute', category: 'Bank Jobs', state: 'All India' },
  { type: 'admit-card', title: '[Sample] Railway Group D Admit Card 2026 – Download Hall Ticket', organization: 'Sample Railway Recruitment Cell', category: 'Railway Jobs', state: 'All India',
    exam_date: d(10), summary: 'Admit cards are available for download 4 days before the exam date.',
    how_to_apply: '- Visit the official website\n- Enter your registration number and date of birth\n- Download and print the admit card' },
  { type: 'admit-card', title: '[Sample] Teacher Eligibility Test (TET) 2026 Admit Card', organization: 'Sample Education Services Board', category: 'Teaching Jobs', state: 'Bihar', exam_date: d(14) },
  { type: 'answer-key', title: '[Sample] MTS Exam 2026 Provisional Answer Key & Objection Link', organization: 'Sample Staff Selection Board', category: 'SSC Jobs', state: 'All India',
    summary: 'Candidates can view the provisional answer key and raise objections online with a fee of ₹100 per question.' },
  { type: 'syllabus', title: '[Sample] Police Constable Syllabus & Exam Pattern 2026', organization: 'Sample State Police Recruitment Board', category: 'Police Jobs', state: 'Karnataka',
    content: 'General Knowledge: 30 marks\nReasoning: 25 marks\nMathematics: 25 marks\nKannada / English: 20 marks' },
  { type: 'admission', title: '[Sample] Polytechnic Diploma Admission 2026 – Apply Online', organization: 'Sample Board of Technical Education', state: 'Kerala', last_date: d(18) },
];

function seedIfEmpty() {
  if (posts.count() > 0) return 0;
  for (const s of SAMPLES) posts.markAlerted(posts.create({ links: LINKS, status: 'published', ...s }));
  console.log(`Seeded ${SAMPLES.length} sample posts (delete them in /admin before going live).`);
  return SAMPLES.length;
}

module.exports = { seedIfEmpty };
if (require.main === module) seedIfEmpty();
