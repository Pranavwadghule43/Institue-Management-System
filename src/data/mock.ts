/* Deterministic sample data for the UI prototype. Replace with API calls
   (TanStack Query) when the FastAPI backend is ready. Dates are relative to
   "today" so the demo always looks current. */
import type {
  AuditEntry, Backup, Batch, Bill, Course, Customer, Expense, Installment, Job, JobDoc, JobEvent,
  JobStatus, PayMode, Payment, Priority, Service, ServiceCategory, Staff, Student, StudentStatus, Enquiry, CourseSubtype,
} from './types';

let seed = 20261012;
const rnd = () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = <T,>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)];
const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
const chance = (p: number) => rnd() < p;
const round = (n: number, to = 100) => Math.round(n / to) * to;

export const NOW = new Date();
export const TODAY = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate());
export const day = (offset: number, h = 10, m = 0) => {
  const d = new Date(TODAY);
  d.setDate(d.getDate() + offset);
  d.setHours(h, m, 0, 0);
  return d;
};
const atWorkHour = (offset: number) => {
  let d = day(offset, int(9, 19), int(0, 59));
  if (offset === 0 && d > NOW) d = new Date(NOW.getTime() - int(5, 240) * 60000);
  return d;
};
const YEAR = TODAY.getFullYear();

/* ------------------------------ Staff ------------------------------ */

export const staff: Staff[] = [
  { id: 'U1', name: 'Rakesh Verma', username: 'admin', role: 'Admin', phone: '98765 43210', status: 'Active', lastLogin: new Date(NOW.getTime() - 3 * 60000), designation: 'Director' },
  { id: 'U2', name: 'Priya Sharma', username: 'priya.s', role: 'Staff', phone: '98110 22334', status: 'Active', lastLogin: new Date(NOW.getTime() - 42 * 60000), designation: 'Front Desk & Accounts' },
  { id: 'U3', name: 'Amit Kumar', username: 'amit.k', role: 'Staff', phone: '99550 11872', status: 'Active', lastLogin: new Date(NOW.getTime() - 95 * 60000), designation: 'Service Operator' },
  { id: 'U4', name: 'Neha Gupta', username: 'neha.g', role: 'Staff', phone: '97180 66541', status: 'Active', lastLogin: day(-1, 18, 12), designation: 'Faculty' },
  { id: 'U5', name: 'Sunil Yadav', username: 'sunil.y', role: 'Staff', phone: '93100 74520', status: 'Locked', lastLogin: day(-6, 11, 4), designation: 'Service Operator' },
  { id: 'U6', name: 'Kavita Joshi', username: 'kavita.j', role: 'Staff', phone: '88260 90311', status: 'Disabled', lastLogin: day(-48, 16, 30), designation: 'Faculty (former)' },
];
export const staffById = (id: string) => staff.find((s) => s.id === id)!;

/* --------------------------- Courses/Batches --------------------------- */

export const courses: Course[] = [
  { id: 'C1', code: 'DCA', name: 'Diploma in Computer Applications', duration: 6, fee: 7500, description: 'MS Office, Internet, basics of computing and typing.', active: true },
  { id: 'C2', code: 'ADCA', name: 'Advanced Diploma in Computer Applications', duration: 12, fee: 14000, description: 'DCA + Tally, DTP, HTML basics and project work.', active: true },
  { id: 'C3', code: 'TALLY', name: 'Tally Prime with GST', duration: 3, fee: 6500, description: 'Accounting, inventory, GST returns and payroll in Tally Prime.', active: true },
  { id: 'C4', code: 'CCC', name: 'Course on Computer Concepts', duration: 3, fee: 3500, description: 'NIELIT CCC syllabus with exam preparation.', active: true },
  { id: 'C5', code: 'WEB', name: 'Web Design & Development', duration: 6, fee: 18000, description: 'HTML, CSS, JavaScript, React basics and hosting.', active: true },
  { id: 'C6', code: 'PY', name: 'Python Programming', duration: 4, fee: 12000, description: 'Core Python, data handling and mini projects.', active: true },
  { id: 'C7', code: 'EXCEL', name: 'Advanced Excel & MIS', duration: 2, fee: 4500, description: 'Formulas, pivot tables, dashboards and MIS reports.', active: true },
  { id: 'C8', code: 'TYPE', name: 'Hindi & English Typing', duration: 2, fee: 2500, description: 'Speed typing for government exams (Mangal & English).', active: true },
  { id: 'C9', code: 'DTP', name: 'Desktop Publishing', duration: 4, fee: 8000, description: 'CorelDRAW, Photoshop and PageMaker.', active: false },
];
export const courseById = (id: string) => courses.find((c) => c.id === id)!;
export const courseSubtypes: CourseSubtype[] = [];
export const enquiries: Enquiry[] = [];

const teachers = ['Neha Gupta', 'Vikas Mishra', 'Pooja Tiwari', 'Arjun Mehta'];
export const batches: Batch[] = [
  { id: 'B1', name: 'DCA Morning A', courseId: 'C1', timing: '8:00 – 9:30 AM', days: 'Mon – Sat', teacher: 'Neha Gupta', capacity: 30, start: day(-120), end: day(60), status: 'Running' },
  { id: 'B2', name: 'DCA Evening B', courseId: 'C1', timing: '5:00 – 6:30 PM', days: 'Mon – Sat', teacher: 'Pooja Tiwari', capacity: 30, start: day(-60), end: day(120), status: 'Running' },
  { id: 'B3', name: 'ADCA Weekday', courseId: 'C2', timing: '10:00 – 11:30 AM', days: 'Mon – Fri', teacher: 'Vikas Mishra', capacity: 25, start: day(-200), end: day(165), status: 'Running' },
  { id: 'B4', name: 'ADCA Evening', courseId: 'C2', timing: '6:30 – 8:00 PM', days: 'Mon – Sat', teacher: 'Arjun Mehta', capacity: 25, start: day(-90), end: day(275), status: 'Running' },
  { id: 'B5', name: 'Tally Prime 11 AM', courseId: 'C3', timing: '11:30 AM – 1:00 PM', days: 'Mon – Sat', teacher: 'Neha Gupta', capacity: 20, start: day(-45), end: day(45), status: 'Running' },
  { id: 'B6', name: 'CCC Fast Track', courseId: 'C4', timing: '2:00 – 3:30 PM', days: 'Mon – Sat', teacher: 'Pooja Tiwari', capacity: 30, start: day(-30), end: day(60), status: 'Running' },
  { id: 'B7', name: 'Web Dev Weekend', courseId: 'C5', timing: '9:00 AM – 1:00 PM', days: 'Sat – Sun', teacher: 'Arjun Mehta', capacity: 15, start: day(-75), end: day(105), status: 'Running' },
  { id: 'B8', name: 'Python Batch 3', courseId: 'C6', timing: '4:00 – 5:30 PM', days: 'Mon – Fri', teacher: 'Vikas Mishra', capacity: 15, start: day(-50), end: day(70), status: 'Running' },
  { id: 'B9', name: 'Excel MIS Evening', courseId: 'C7', timing: '7:00 – 8:00 PM', days: 'Mon – Fri', teacher: 'Neha Gupta', capacity: 20, start: day(-20), end: day(40), status: 'Running' },
  { id: 'B10', name: 'Typing Lab', courseId: 'C8', timing: '3:30 – 4:30 PM', days: 'Mon – Sat', teacher: 'Pooja Tiwari', capacity: 24, start: day(-25), end: day(35), status: 'Running' },
  { id: 'B11', name: 'Tally Prime Nov', courseId: 'C3', timing: '5:00 – 6:30 PM', days: 'Mon – Sat', teacher: 'Neha Gupta', capacity: 20, start: day(20), end: day(110), status: 'Upcoming' },
  { id: 'B12', name: 'CCC Batch July', courseId: 'C4', timing: '2:00 – 3:30 PM', days: 'Mon – Sat', teacher: 'Pooja Tiwari', capacity: 30, start: day(-150), end: day(-60), status: 'Completed' },
];
void teachers;
export const batchById = (id: string) => batches.find((b) => b.id === id)!;

/* ------------------------------ Students ------------------------------ */

const firstM = ['Aarav', 'Vivaan', 'Aditya', 'Rohan', 'Arjun', 'Karan', 'Rahul', 'Sahil', 'Ankit', 'Deepak', 'Manish', 'Nikhil', 'Harsh', 'Yash', 'Ravi', 'Gaurav', 'Saurabh', 'Abhishek', 'Vikas', 'Mohit', 'Shivam', 'Ayush', 'Pranav', 'Kunal', 'Tushar', 'Akash', 'Sachin', 'Rajat', 'Varun', 'Aman'];
const firstF = ['Ananya', 'Diya', 'Isha', 'Kavya', 'Riya', 'Sneha', 'Pooja', 'Neha', 'Anjali', 'Priya', 'Khushi', 'Simran', 'Tanvi', 'Shruti', 'Muskan', 'Nidhi', 'Aditi', 'Komal', 'Sakshi', 'Jyoti', 'Megha', 'Payal', 'Sonam', 'Divya', 'Kritika'];
const last = ['Sharma', 'Verma', 'Gupta', 'Singh', 'Yadav', 'Kumar', 'Mishra', 'Tiwari', 'Pandey', 'Chauhan', 'Agarwal', 'Jain', 'Saxena', 'Srivastava', 'Patel', 'Rawat', 'Thakur', 'Dubey', 'Rajput', 'Bansal', 'Mehta', 'Joshi', 'Kushwaha', 'Maurya'];
const fathers = ['Ramesh', 'Suresh', 'Mahesh', 'Rajesh', 'Dinesh', 'Mukesh', 'Anil', 'Sunil', 'Vinod', 'Ashok', 'Rakesh', 'Naresh', 'Sanjay', 'Ajay', 'Pramod', 'Santosh', 'Rajendra', 'Om Prakash'];
const areas = ['Civil Lines', 'Station Road', 'Gandhi Nagar', 'Shastri Colony', 'Nehru Nagar', 'Rajendra Nagar', 'Kamla Market', 'Subhash Chowk', 'Ram Vihar', 'Indira Colony', 'Ashok Nagar', 'Patel Marg'];
const phone = () => `${pick(['98', '97', '99', '96', '93', '88', '87', '70', '79', '63'])}${int(100, 999)} ${int(10000, 99999)}`;

const courseWeights = ['C1', 'C1', 'C1', 'C2', 'C2', 'C3', 'C3', 'C4', 'C4', 'C5', 'C6', 'C7', 'C8'];
const runningBatchFor = (cid: string) => batches.filter((b) => b.courseId === cid && b.status === 'Running');

export const students: Student[] = [];
export const payments: Payment[] = [];

const STUDENT_COUNT = 186;
for (let i = 0; i < STUDENT_COUNT; i++) {
  const female = chance(0.46);
  const fn = female ? pick(firstF) : pick(firstM);
  const ln = pick(last);
  let courseId = pick(courseWeights);
  let batchOptions = runningBatchFor(courseId);
  // older admissions may belong to completed CCC batch
  let admissionOffset = -int(0, 210);
  if (i >= STUDENT_COUNT - 3) admissionOffset = 0; // today's admissions
  if (courseId === 'C4' && admissionOffset < -150) batchOptions = [batchById('B12')];
  if (!batchOptions.length) {
    courseId = 'C1';
    batchOptions = runningBatchFor('C1');
  }
  const batch = pick(batchOptions);
  const course = courseById(courseId);
  const discount = pick([0, 0, 0, 0, 250, 500, 500, 1000]);
  const net = course.fee - discount;
  const down = round(net * pick([0.25, 0.3, 0.4, 0.5]), 500);
  const nInst = course.duration >= 6 ? int(3, 4) : course.duration >= 3 ? 2 : 1;
  const per = round((net - down) / nInst, 50);
  const insts: Installment[] = [{ no: 0, due: day(admissionOffset), amount: down, paid: 0 }];
  let allocated = down;
  for (let k = 1; k <= nInst; k++) {
    const amt = k === nInst ? net - allocated : per;
    allocated += amt;
    insts.push({ no: k, due: day(admissionOffset + 30 * k), amount: amt, paid: 0 });
  }

  const id = `UC-${YEAR}-${String(i + 1).padStart(4, '0')}`;
  const willDrop = chance(0.04);
  // pay installments
  for (const inst of insts) {
    const off = Math.round((inst.due.getTime() - TODAY.getTime()) / 86400000);
    let payOffset: number | null = null;
    if (inst.no === 0) payOffset = off;
    else if (off < -40) payOffset = chance(willDrop ? 0.2 : 0.995) ? off + int(-3, 3) : null;
    else if (off < -3) payOffset = chance(willDrop ? 0.2 : 0.93) ? off + int(-3, 3) : null;
    else if (off <= 0) payOffset = chance(0.45) ? Math.min(0, off + int(0, 2)) : null;
    else if (off <= 10) payOffset = chance(0.12) ? -int(0, 3) : null;
    if (payOffset !== null) {
      payOffset = Math.min(0, Math.max(admissionOffset, payOffset));
      const partial = inst.no > 0 && off < -3 && off > -40 && chance(0.04);
      const amt = partial ? round(inst.amount * 0.5, 100) : inst.amount;
      inst.paid = amt;
      payments.push({
        id: '', receiptNo: '', studentId: id, amount: amt,
        mode: pick<PayMode>(['Cash', 'Cash', 'Cash', 'GPay', 'GPay', 'PhonePe', 'PhonePe', 'UPI', 'Card', 'Bank']),
        reference: '', at: atWorkHour(payOffset), by: pick(['U1', 'U2', 'U2', 'U2', 'U4']), status: 'Valid',
      });
    }
  }
  const paid = insts.reduce((s, x) => s + x.paid, 0);
  const endOff = admissionOffset + course.duration * 30;
  let status: StudentStatus = 'Active';
  if (willDrop) status = 'Left';
  else if (endOff < 0 && paid >= net) status = 'Completed';

  students.push({
    id, name: `${fn} ${ln}`, fatherName: `${pick(fathers)} ${ln}`, gender: female ? 'Female' : 'Male',
    dob: new Date(YEAR - int(16, 27), int(0, 11), int(1, 28)), phone: phone(),
    email: chance(0.7) ? `${fn.toLowerCase()}.${ln.toLowerCase()}${int(1, 99)}@gmail.com` : '',
    address: `${int(1, 240)}, ${pick(areas)}`, aadhaar: `${int(2000, 9999)} ${int(1000, 9999)} ${int(1000, 9999)}`,
    courseId, batchId: batch.id, admissionDate: atWorkHour(admissionOffset), courseFee: course.fee, discount,
    status, installments: insts, lastReminded: chance(0.3) ? day(-int(1, 12)) : null,
  });
}

// a few service-side reversals for realism
payments.sort((a, b) => a.at.getTime() - b.at.getTime());
payments.forEach((p, i) => {
  p.id = `P${i + 1}`;
  p.receiptNo = `RCP-${YEAR}-${String(1200 + i + 1).padStart(5, '0')}`;
  if (p.mode === 'UPI' || p.mode === 'GPay' || p.mode === 'PhonePe') p.reference = `UPI${int(100000, 999999)}${int(1000, 9999)}`;
  if (p.mode === 'Bank') p.reference = `NEFT/${int(10000000, 99999999)}`;
  if (p.mode === 'Card') p.reference = `XXXX ${int(1000, 9999)}`;
});
const rev = payments[Math.floor(payments.length * 0.8)];
rev.status = 'Reversed';
rev.remark = 'Duplicate entry — reversed by Admin';

export const studentById = (id: string) => students.find((s) => s.id === id)!;

/* ------------------------------ Services ------------------------------ */

export const serviceCategories: ServiceCategory[] = [
  { id: 'SC1', name: 'Identity Documents' },
  { id: 'SC2', name: 'Certificates' },
  { id: 'SC3', name: 'Online Applications' },
  { id: 'SC4', name: 'Travel & Bookings' },
  { id: 'SC5', name: 'Bill Payments' },
  { id: 'SC6', name: 'Printing & Office' },
  { id: 'SC7', name: 'Tax & Finance' },
];

export const services: Service[] = [
  { id: 'S1', name: 'PAN Card — New', categoryId: 'SC1', price: 250, docs: ['Aadhaar Card', 'Passport Photo', 'Signature'], active: true },
  { id: 'S2', name: 'PAN Card — Correction', categoryId: 'SC1', price: 200, docs: ['Existing PAN', 'Aadhaar Card', 'Proof of Correction'], active: true },
  { id: 'S3', name: 'Aadhaar Address Update', categoryId: 'SC1', price: 100, docs: ['Aadhaar Card', 'Address Proof'], active: true },
  { id: 'S4', name: 'Voter ID Registration', categoryId: 'SC1', price: 100, docs: ['Aadhaar Card', 'Passport Photo', 'Address Proof'], active: true },
  { id: 'S5', name: 'Passport Application', categoryId: 'SC1', price: 600, docs: ['Aadhaar Card', 'PAN Card', '10th Marksheet', 'Address Proof'], active: true },
  { id: 'S6', name: 'Income Certificate', categoryId: 'SC2', price: 150, docs: ['Aadhaar Card', 'Ration Card', 'Self Declaration'], active: true },
  { id: 'S7', name: 'Caste Certificate', categoryId: 'SC2', price: 150, docs: ['Aadhaar Card', 'Ration Card', 'Father’s Caste Certificate'], active: true },
  { id: 'S8', name: 'Domicile Certificate', categoryId: 'SC2', price: 150, docs: ['Aadhaar Card', 'Address Proof'], active: true },
  { id: 'S9', name: 'Govt. Job Form Filling', categoryId: 'SC3', price: 150, docs: ['Passport Photo', 'Signature', 'Marksheets'], active: true },
  { id: 'S10', name: 'Scholarship Application', categoryId: 'SC3', price: 120, docs: ['Aadhaar Card', 'Bank Passbook', 'Income Certificate', 'Fee Receipt'], active: true },
  { id: 'S11', name: 'University Admission Form', categoryId: 'SC3', price: 200, docs: ['Passport Photo', 'Marksheets'], active: true },
  { id: 'S12', name: 'Driving Licence (Learner)', categoryId: 'SC3', price: 400, docs: ['Aadhaar Card', 'Passport Photo', 'Medical Form'], active: true },
  { id: 'S13', name: 'Train Ticket Booking', categoryId: 'SC4', price: 60, docs: [], active: true },
  { id: 'S14', name: 'Bus / Flight Booking', categoryId: 'SC4', price: 100, docs: [], active: true },
  { id: 'S15', name: 'Electricity Bill Payment', categoryId: 'SC5', price: 20, docs: [], active: true },
  { id: 'S16', name: 'B/W Print (per page)', categoryId: 'SC6', price: 3, docs: [], active: true },
  { id: 'S17', name: 'Colour Print (per page)', categoryId: 'SC6', price: 10, docs: [], active: true },
  { id: 'S18', name: 'Lamination', categoryId: 'SC6', price: 30, docs: [], active: true },
  { id: 'S19', name: 'Resume Design', categoryId: 'SC6', price: 150, docs: [], active: true },
  { id: 'S20', name: 'ITR Filing (Salaried)', categoryId: 'SC7', price: 500, docs: ['PAN Card', 'Form 16', 'Bank Statement'], active: true },
  { id: 'S21', name: 'GST Registration', categoryId: 'SC7', price: 1500, docs: ['PAN Card', 'Aadhaar Card', 'Shop Proof', 'Bank Details'], active: false },
];
export const serviceById = (id: string) => services.find((s) => s.id === id)!;

export const customers: Customer[] = [];
const custNames = [
  'Ramesh Chandra', 'Sunita Devi', 'Mohd. Irfan', 'Geeta Rani', 'Harish Pal', 'Kamlesh Yadav', 'Shabnam Bano', 'Rajkumar Singh',
  'Meena Kumari', 'Vinod Saxena', 'Pushpa Verma', 'Imran Khan', 'Laxmi Narayan', 'Asha Mishra', 'Dharmendra Kumar', 'Saroj Bala',
  'Naveen Joshi', 'Farida Begum', 'Brijesh Tiwari', 'Rekha Gupta', 'Jagdish Prasad', 'Anita Chauhan', 'Satish Agarwal', 'Usha Rani',
  'Manoj Pandey', 'Rubina Sheikh', 'Prem Shankar', 'Kiran Rawat', 'Dev Anand Sharma', 'Nirmala Devi', 'Arvind Jain', 'Sushila Thakur',
  'Rajeev Bansal', 'Gulshan Ara', 'Hemant Dubey', 'Savita Maurya', 'Lalit Kushwaha', 'Poonam Rajput', 'Yogesh Mehta', 'Babita Kumari',
];
custNames.forEach((name, i) => {
  const m = phone();
  customers.push({ id: `CU-${String(i + 1).padStart(4, '0')}`, name, mobile: m, whatsapp: chance(0.85) ? m : phone(), address: `${int(1, 300)}, ${pick(areas)}`, createdAt: day(-int(5, 220)) });
});
export const customerById = (id: string) => customers.find((c) => c.id === id)!;

const formNames: Record<string, string[]> = {
  S9: ['SSC CGL 2026', 'UP Police Constable', 'Railway Group D', 'IBPS Clerk', 'CTET December', 'Army Agniveer'],
  S10: ['Post-Matric Scholarship', 'NSP Merit Scholarship'],
  S11: ['B.A. Admission — State University', 'B.Com Admission', 'D.El.Ed Counselling'],
  S5: ['Passport — Fresh (Normal)', 'Passport — Renewal'],
};

export const jobs: Job[] = [];
export const bills: Bill[] = [];

const statusPlan: JobStatus[] = [
  ...Array(10).fill('Pending'), ...Array(8).fill('In Process'), ...Array(3).fill('On Hold'),
  ...Array(26).fill('Completed'), ...Array(3).fill('Cancelled'),
];
const serviceStaff = ['U2', 'U3', 'U3', 'U5', 'U1'];
let billSeq = 300;

statusPlan.forEach((status, i) => {
  const cust = customers[i % customers.length];
  const main = pick(['S1', 'S1', 'S3', 'S5', 'S6', 'S7', 'S9', 'S9', 'S9', 'S10', 'S11', 'S12', 'S13', 'S20', 'S2', 'S4', 'S8']);
  const serviceIds = [main];
  if (chance(0.45)) serviceIds.push(pick(['S16', 'S17', 'S18', 'S19']));
  let created: number;
  if (status === 'Completed') created = -int(0, 28);
  else if (status === 'Cancelled') created = -int(4, 25);
  else created = -int(0, 9);
  const lastDateOff = status === 'Pending' || status === 'In Process' ? created + int(2, 12) : created + int(3, 14);
  const assignees = Array.from(new Set([pick(serviceStaff), ...(chance(0.35) ? [pick(serviceStaff)] : [])]));
  const docs: JobDoc[] = serviceById(main).docs.map((n, k) => {
    const up = status === 'Completed' || (status !== 'Pending' ? chance(0.75) : chance(0.35)) || k === 0;
    return { name: n, uploaded: up, file: up ? `${n.toLowerCase().replace(/[^a-z0-9]+/g, '_')}.${pick(['pdf', 'jpg', 'png'])}` : undefined, size: up ? `${int(120, 2400)} KB` : undefined, sensitive: /aadhaar|pan|bank|form 16/i.test(n) && !/photo/i.test(n) };
  });
  const by = assignees[0];
  const history: JobEvent[] = [{ at: atWorkHour(created), by: 'U2', status: 'Created', note: 'Job created at counter' }];
  const midOff = Math.min(0, created + int(0, 2));
  if (status !== 'Pending') history.push({ at: atWorkHour(midOff), by, status: status === 'Cancelled' ? 'Cancelled' : 'In Process' });
  if (status === 'On Hold') history.push({ at: atWorkHour(Math.min(0, midOff + 1)), by, status: 'On Hold', note: 'Waiting for customer to bring original documents' });
  if (status === 'Completed') {
    const doneOff = i < 30 && i % 5 === 0 ? 0 : Math.min(0, midOff + int(0, 4));
    history.push({ at: atWorkHour(doneOff), by, status: 'Completed', note: pick(['Acknowledgement slip handed to customer', 'Application submitted successfully', 'Printed copy delivered', 'Confirmation sent on WhatsApp']) });
  }
  if (status === 'Cancelled') history[history.length - 1].note = 'Customer withdrew the request';
  history.sort((a, b) => a.at.getTime() - b.at.getTime());

  const job: Job = {
    id: `SJ-${1040 + i}`, customerId: cust.id, serviceIds,
    formName: formNames[main] ? pick(formNames[main]) : '',
    serviceDate: day(created), lastDate: day(lastDateOff),
    priority: pick<Priority>(['Normal', 'Normal', 'Normal', 'High', 'Urgent']),
    assignees, status, docs, history,
  };

  if (status === 'Completed' || (status === 'In Process' && chance(0.4)) || (status === 'Cancelled' && i % 2 === 0)) {
    billSeq++;
    const items = serviceIds.map((sid) => {
      const sv = serviceById(sid);
      const qty = sv.price < 20 ? int(5, 40) : 1;
      return { serviceId: sid, qty, rate: sv.price };
    });
    const doneAt = history[history.length - 1].at;
    const paidBill = status === 'Completed' ? chance(0.86) : false;
    const bill: Bill = {
      id: `SB-${YEAR}-${String(billSeq).padStart(4, '0')}`, jobId: job.id, customerId: cust.id, items,
      discount: chance(0.2) ? pick([10, 20, 50]) : 0,
      status: status === 'Cancelled' ? 'Cancelled' : paidBill ? 'Paid' : 'Unpaid',
      mode: paidBill ? pick<PayMode>(['Cash', 'Cash', 'Cash', 'GPay', 'PhonePe', 'PhonePe', 'UPI']) : undefined,
      createdAt: doneAt, paidAt: paidBill ? doneAt : undefined, by,
      cancelReason: status === 'Cancelled' ? 'Customer withdrew the request' : undefined,
    };
    bills.push(bill);
    job.billId = bill.id;
  }
  jobs.push(job);
});
export const jobById = (id: string) => jobs.find((j) => j.id === id)!;
export const billById = (id: string) => bills.find((b) => b.id === id)!;
export const billTotal = (b: Bill) => Math.max(0, b.items.reduce((s, it) => s + it.qty * it.rate, 0) - b.discount);
export const billSubtotal = (b: Bill) => b.items.reduce((s, it) => s + it.qty * it.rate, 0);

/* ------------------------------ Expenses ------------------------------ */

export const expenseCategories = ['Rent', 'Salary', 'Electricity', 'Internet & Phone', 'Stationery', 'Printer & Toner', 'Maintenance', 'Marketing', 'Refreshments', 'Miscellaneous', 'Other'];
export const expenses: Expense[] = [];
let expSeq = 0;
const addExp = (offset: number, amount: number, category: string, remark: string, mode: PayMode = 'Cash', attachment?: string) => {
  expSeq++;
  expenses.push({ id: `EX-${String(expSeq).padStart(4, '0')}`, date: atWorkHour(offset), amount, category, remark, by: pick(['U1', 'U2']), mode, attachment });
};
for (let m = 0; m < 3; m++) {
  const first = new Date(TODAY.getFullYear(), TODAY.getMonth() - m, 1);
  const off = Math.round((first.getTime() - TODAY.getTime()) / 86400000);
  addExp(off, 18000, 'Rent', 'Monthly shop rent', 'Bank', 'rent_receipt.pdf');
  if (off + 4 <= 0) addExp(off + 4, 52000, 'Salary', 'Staff salaries', 'Bank');
  if (off + 9 <= 0) addExp(off + 9, int(32, 46) * 100, 'Electricity', 'Electricity bill', 'GPay', 'electricity_bill.pdf');
  if (off + 6 <= 0) addExp(off + 6, 1199, 'Internet & Phone', 'Broadband — 200 Mbps plan', 'PhonePe');
}
for (let d = -75; d <= 0; d++) {
  if (chance(0.55)) addExp(d, int(6, 25) * 10, 'Refreshments', pick(['Tea & snacks', 'Drinking water cans', 'Tea for staff']));
  if (chance(0.12)) addExp(d, int(3, 14) * 100, 'Stationery', pick(['Register & pens', 'A4 paper rims', 'Receipt book printing', 'Files & folders']));
  if (chance(0.05)) addExp(d, int(12, 28) * 100, 'Printer & Toner', pick(['HP toner refill', 'Epson ink bottles', 'Printer drum change']), 'UPI');
  if (chance(0.04)) addExp(d, int(5, 30) * 100, 'Maintenance', pick(['UPS battery service', 'AC servicing', 'Keyboard & mouse replacement', 'Plumbing work']));
  if (chance(0.025)) addExp(d, int(15, 45) * 100, 'Marketing', pick(['Pamphlet printing', 'Local newspaper ad', 'Flex banner']), 'UPI', 'invoice.pdf');
}
addExp(0, 240, 'Refreshments', 'Tea & snacks for staff');
addExp(0, 850, 'Stationery', 'Receipt book & register');
expenses.sort((a, b) => b.date.getTime() - a.date.getTime());

/* ------------------------------ Audit ------------------------------ */

export const audit: AuditEntry[] = [];
const ip = () => `192.168.1.${int(10, 60)}`;
const recentPays = payments.slice(-14);
recentPays.forEach((p, i) => {
  const s = studentById(p.studentId);
  audit.push({ id: `A${i}`, at: p.at, actor: p.by, action: 'PAYMENT_CREATED', entity: 'Payment', entityId: p.receiptNo, summary: `Collected ₹${p.amount.toLocaleString('en-IN')} from ${s.name} (${p.mode})`, ip: ip() });
});
audit.push(
  { id: 'AX1', at: day(-1, 17, 42), actor: 'U1', action: 'SERVICE_RATE_UPDATED', entity: 'Service', entityId: 'S5', summary: 'Passport Application price updated', ip: '192.168.1.11', before: { price: '₹550' }, after: { price: '₹600' } },
  { id: 'AX2', at: day(-2, 12, 5), actor: 'U1', action: 'PERMISSION_CHANGED', entity: 'Staff', entityId: 'U3', summary: 'Granted expenses.create to Amit Kumar', ip: '192.168.1.11', before: { 'expenses.create': 'Denied' }, after: { 'expenses.create': 'Allowed' } },
  { id: 'AX3', at: day(-3, 15, 18), actor: 'U1', action: 'PAYMENT_REVERSED', entity: 'Payment', entityId: rev.receiptNo, summary: 'Duplicate payment reversed', ip: '192.168.1.11', before: { status: 'Valid', amount: `₹${rev.amount}` }, after: { status: 'Reversed', amount: `₹${rev.amount}` } },
  { id: 'AX4', at: day(-1, 9, 2), actor: 'U5', action: 'LOGIN_FAILED', entity: 'Auth', entityId: 'sunil.y', summary: '5 failed attempts — account locked', ip: '192.168.1.48' },
  { id: 'AX5', at: day(-4, 11, 30), actor: 'U2', action: 'STUDENT_UPDATED', entity: 'Student', entityId: students[40].id, summary: `Phone number changed for ${students[40].name}`, ip: '192.168.1.23', before: { phone: '98•••• 1182' }, after: { phone: students[40].phone.slice(0, 2) + '•••• ' + students[40].phone.slice(-4) } },
  { id: 'AX6', at: day(-5, 16, 10), actor: 'U1', action: 'BILL_CANCELLED', entity: 'Service Bill', entityId: bills.find((b) => b.status === 'Cancelled')?.id ?? 'SB', summary: 'Service bill cancelled — customer withdrew', ip: '192.168.1.11', before: { status: 'Unpaid' }, after: { status: 'Cancelled' } },
  { id: 'AX7', at: day(-6, 10, 45), actor: 'U1', action: 'EXPENSE_DELETED', entity: 'Expense', entityId: 'EX-0007', summary: 'Duplicate stationery expense removed', ip: '192.168.1.11', before: { amount: '₹450', category: 'Stationery' }, after: { status: 'Deleted' } },
  { id: 'AX8', at: day(0, 9, 3), actor: 'U1', action: 'LOGIN_SUCCESS', entity: 'Auth', entityId: 'admin', summary: 'Signed in', ip: '192.168.1.11' },
  { id: 'AX9', at: day(-1, 2, 0), actor: 'U1', action: 'BACKUP_COMPLETED', entity: 'System', entityId: 'BK', summary: 'Automatic daily backup completed', ip: 'server' },
  { id: 'AX10', at: day(-8, 13, 20), actor: 'U1', action: 'COURSE_UPDATED', entity: 'Course', entityId: 'C5', summary: 'Web Design & Development fee updated', ip: '192.168.1.11', before: { fee: '₹16,000' }, after: { fee: '₹18,000' } },
);
jobs.slice(-8).forEach((j, i) => {
  const h = j.history[j.history.length - 1];
  audit.push({ id: `AJ${i}`, at: h.at, actor: h.by, action: 'JOB_STATUS_CHANGED', entity: 'Service Job', entityId: j.id, summary: `${j.id} marked ${h.status}`, ip: ip(), after: { status: String(h.status) } });
});
audit.sort((a, b) => b.at.getTime() - a.at.getTime());

/* ------------------------------ Backups ------------------------------ */

export const backups: Backup[] = [];
for (let d = 0; d < 16; d++) {
  const at = day(-d, 2, 0);
  if (d === 0 && NOW.getHours() < 2) continue;
  backups.push({ id: `BK${d}`, at, type: at.getDay() === 0 ? 'Weekly (auto)' : 'Daily (auto)', size: `${(48.2 - d * 0.31).toFixed(1)} MB`, status: d === 9 ? 'Failed' : 'Success', verified: d % 7 === 0 });
}
backups.splice(2, 0, { id: 'BKM', at: day(-2, 19, 34), type: 'Manual', size: '47.6 MB', status: 'Success', verified: true });

/* -------------------- Monthly history for P&L charts -------------------- */

export interface MonthRow { label: string; fees: number; services: number; expenses: number; partial?: boolean }
export const monthHistory: MonthRow[] = (() => {
  const rows: MonthRow[] = [];
  for (let m = 11; m >= 1; m--) {
    const d = new Date(TODAY.getFullYear(), TODAY.getMonth() - m, 1);
    const season = 1 + 0.25 * Math.sin((d.getMonth() + 2) / 1.9);
    rows.push({
      label: d.toLocaleString('en-IN', { month: 'short' }) + (d.getMonth() === 0 ? ` ’${String(d.getFullYear()).slice(2)}` : ''),
      fees: round(int(138, 176) * 1000 * season, 100),
      services: round(int(26, 38) * 1000 * (0.9 + rnd() * 0.25), 100),
      expenses: round(int(82, 96) * 1000, 100),
    });
  }
  return rows;
})();

export const DEMO_ROLES = { Admin: staff[0], Staff: staff[1] } as const;
