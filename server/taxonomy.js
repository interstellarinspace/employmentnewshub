// Fixed lists used for filters, menus and the admin form. Edit freely.
const TYPES = {
  job:          { label: 'Latest Jobs',  singular: 'Job',         path: 'jobs' },
  result:       { label: 'Results',      singular: 'Result',      path: 'results' },
  'admit-card': { label: 'Admit Cards',  singular: 'Admit Card',  path: 'admit-cards' },
  'answer-key': { label: 'Answer Keys',  singular: 'Answer Key',  path: 'answer-keys' },
  syllabus:     { label: 'Syllabus',     singular: 'Syllabus',    path: 'syllabus' },
  admission:    { label: 'Admissions',   singular: 'Admission',   path: 'admissions' },
};

const CATEGORIES = [
  'Bank Jobs', 'Railway Jobs', 'SSC Jobs', 'Defence Jobs', 'Police Jobs', 'Teaching Jobs',
  'PSU Jobs', 'Engineering Jobs', 'Medical Jobs', 'State Govt Jobs', 'Central Govt Jobs', 'Private Jobs',
];

const QUALIFICATIONS = [
  '8th Pass', '10th Pass', '12th Pass', 'ITI', 'Diploma', 'Graduate', 'B.Tech/B.E', 'Post Graduate',
  'MBBS', 'Nursing', 'B.Ed', 'CA/CS', 'Any',
];

const STATES = [
  'All India', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Delhi', 'Goa', 'Gujarat',
  'Haryana', 'Himachal Pradesh', 'Jammu & Kashmir', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh',
  'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim',
  'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
];

function slugify(s) {
  return String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);
}

const fromSlug = (list, slug) => list.find((x) => slugify(x) === slug) || null;
const typeByPath = (p) => Object.entries(TYPES).find(([, t]) => t.path === p)?.[0] || null;

module.exports = { TYPES, CATEGORIES, QUALIFICATIONS, STATES, slugify, fromSlug, typeByPath };
