/* In-memory store standing in for the API. Selectors mirror what the backend
   aggregation endpoints will return; React never treats these as authoritative
   once the real API is wired (see 08_FRONTEND_ARCHITECTURE). */
import { useSyncExternalStore } from 'react';
import * as M from './mock';
import type { Bill, BillItem, Customer, Enquiry, EnquiryStatus, Expense, JobStatus, PayMode, Payment, Student } from './types';
import { addMonthsClamped } from '../lib/schedule';

let version = 0;
const listeners = new Set<() => void>();
const emit = () => {
  version++;
  listeners.forEach((l) => l());
};
export function useStore() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
  );
}

export const db = M;
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
export const isToday = (d: Date) => sameDay(d, M.TODAY);
export { sameDay };

/* ------------------------------ Student fees ------------------------------ */

export const netFee = (s: Student) => s.courseFee - s.discount;
export const studentPayments = (s: Student) => M.payments.filter((p) => p.studentId === s.id).sort((a, b) => b.at.getTime() - a.at.getTime());
export const paidFor = (s: Student) => studentPayments(s).filter((p) => p.status === 'Valid').reduce((t, p) => t + p.amount, 0);
export const balanceFor = (s: Student) => Math.max(0, netFee(s) - paidFor(s));

export type InstState = 'Paid' | 'Partial' | 'Overdue' | 'Due Today' | 'Upcoming';
export interface ScheduleRow { no: number; due: Date; amount: number; paid: number; state: InstState }

export function scheduleFor(s: Student): ScheduleRow[] {
  let pool = paidFor(s);
  return s.installments.map((inst) => {
    const paid = Math.min(pool, inst.amount);
    pool -= paid;
    let state: InstState;
    if (paid >= inst.amount) state = 'Paid';
    else if (isToday(inst.due)) state = 'Due Today';
    else if (inst.due < M.TODAY) state = 'Overdue';
    else state = paid > 0 ? 'Partial' : 'Upcoming';
    return { no: inst.no, due: inst.due, amount: inst.amount, paid, state };
  });
}

export function nextDue(s: Student) {
  const row = scheduleFor(s).find((r) => r.state !== 'Paid');
  return row ? { ...row, remaining: row.amount - row.paid } : null;
}

export type FeeState = 'Fully Paid' | 'Overdue' | 'Due Today' | 'Due Tomorrow' | 'On Track';
export function feeState(s: Student): FeeState {
  const n = nextDue(s);
  if (!n) return 'Fully Paid';
  if (n.state === 'Overdue') return 'Overdue';
  if (n.state === 'Due Today') return 'Due Today';
  const t = new Date(M.TODAY);
  t.setDate(t.getDate() + 1);
  if (sameDay(n.due, t)) return 'Due Tomorrow';
  return 'On Track';
}

export const overdueDays = (s: Student) => {
  const n = nextDue(s);
  if (!n || n.due >= M.TODAY) return 0;
  return Math.round((M.TODAY.getTime() - n.due.getTime()) / 86400000);
};

/* ------------------------------ Dashboard ------------------------------ */

export const validPaymentsOn = (d: Date) => M.payments.filter((p) => p.status === 'Valid' && sameDay(p.at, d));
export const paidBillsOn = (d: Date) => M.bills.filter((b) => b.status === 'Paid' && b.paidAt && sameDay(b.paidAt, d));
export const expensesOn = (d: Date) => M.expenses.filter((e) => sameDay(e.date, d));
const sum = <T,>(a: T[], f: (x: T) => number) => a.reduce((t, x) => t + f(x), 0);
export { sum };

export function dayTotals(d: Date) {
  const fees = sum(validPaymentsOn(d), (p) => p.amount);
  const services = sum(paidBillsOn(d), M.billTotal);
  const expenses = sum(expensesOn(d), (e) => e.amount);
  return { fees, services, expenses, net: fees + services - expenses };
}

export function kpis() {
  const t = dayTotals(M.TODAY);
  const y = dayTotals(M.day(-1));
  const active = M.students.filter((s) => s.status === 'Active');
  const pendingFees = sum(M.students.filter((s) => s.status === 'Active'), balanceFor);
  const overdueCount = active.filter((s) => feeState(s) === 'Overdue').length;
  const jobsBy = (st: JobStatus) => M.jobs.filter((j) => j.status === st).length;
  const completedToday = M.jobs.filter((j) => j.status === 'Completed' && j.history.some((h) => h.status === 'Completed' && isToday(h.at))).length;
  const pendingServiceAmount = sum(M.bills.filter((b) => b.status === 'Unpaid'), M.billTotal);
  return {
    totalStudents: M.students.length,
    activeStudents: active.length,
    todayAdmissions: M.students.filter((s) => isToday(s.admissionDate)).length,
    monthAdmissions: M.students.filter((s) => s.admissionDate.getMonth() === M.TODAY.getMonth() && s.admissionDate.getFullYear() === M.TODAY.getFullYear()).length,
    today: t,
    yesterday: y,
    pendingFees,
    overdueCount,
    jobs: {
      Pending: jobsBy('Pending'),
      'In Process': jobsBy('In Process'),
      'On Hold': jobsBy('On Hold'),
      Completed: jobsBy('Completed'),
      Cancelled: jobsBy('Cancelled'),
    } as Record<JobStatus, number>,
    completedToday,
    pendingServiceAmount,
    unpaidBills: M.bills.filter((b) => b.status === 'Unpaid').length,
  };
}

export function series(days: number) {
  const out: { date: Date; fees: number; services: number; expenses: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = M.day(-i);
    out.push({ date: d, ...dayTotals(d) });
  }
  return out;
}

export function monthTotals(offset = 0) {
  const y = M.TODAY.getFullYear();
  const m = M.TODAY.getMonth() + offset;
  const inMonth = (d: Date) => d.getFullYear() === new Date(y, m, 1).getFullYear() && d.getMonth() === new Date(y, m, 1).getMonth();
  const fees = sum(M.payments.filter((p) => p.status === 'Valid' && inMonth(p.at)), (p) => p.amount);
  const services = sum(M.bills.filter((b) => b.status === 'Paid' && b.paidAt && inMonth(b.paidAt)), M.billTotal);
  const exp = M.expenses.filter((e) => inMonth(e.date));
  const byCat: Record<string, number> = {};
  exp.forEach((e) => (byCat[e.category] = (byCat[e.category] ?? 0) + e.amount));
  return { fees, services, expenses: sum(exp, (e) => e.amount), byCat };
}

/** Totals for any inclusive date range — feeds P&L day / week / custom (FR-032) */
export function rangeTotals(from: Date, to: Date) {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate(), 23, 59, 59);
  const inR = (d: Date) => d >= a && d <= b;
  const fees = sum(M.payments.filter((p) => p.status === 'Valid' && inR(p.at)), (p) => p.amount);
  const services = sum(M.bills.filter((x) => x.status === 'Paid' && x.paidAt && inR(x.paidAt)), M.billTotal);
  const exp = M.expenses.filter((e) => inR(e.date));
  const byCat: Record<string, number> = {};
  exp.forEach((e) => (byCat[e.category] = (byCat[e.category] ?? 0) + e.amount));
  return { fees, services, expenses: sum(exp, (e) => e.amount), byCat };
}

/* ------------------------------ Services ------------------------------ */

export const customerJobs = (c: Customer) => M.jobs.filter((j) => j.customerId === c.id);
export const customerBills = (c: Customer) => M.bills.filter((b) => b.customerId === c.id);
export const lastVisit = (c: Customer) => {
  const d = customerJobs(c).map((j) => j.serviceDate.getTime());
  return d.length ? new Date(Math.max(...d)) : c.createdAt;
};
export const jobAmount = (jobId: string) => {
  const j = M.jobById(jobId);
  if (j.billId) return M.billTotal(M.billById(j.billId));
  return sum(j.serviceIds, (sid) => M.serviceById(sid).price);
};

/* ------------------------------ Mutations ------------------------------ */

let audSeq = 1000;
function log(actor: string, action: string, entity: string, entityId: string, summary: string, before?: Record<string, string>, after?: Record<string, string>) {
  M.audit.unshift({ id: `N${audSeq++}`, at: new Date(), actor, action, entity, entityId, summary, ip: '192.168.1.11', before, after });
}

export function collectFee(studentId: string, amount: number, mode: PayMode, reference: string, remark: string, by: string): Payment {
  const student = M.students.find((s) => s.id === studentId);
  if (!student || !Number.isFinite(amount) || amount <= 0 || amount > balanceFor(student)) throw new Error('Payment must be positive and within the outstanding balance.');
  const last = M.payments[M.payments.length - 1];
  const n = parseInt(last.receiptNo.split('-')[2], 10) + 1;
  const p: Payment = {
    id: `P${M.payments.length + 1}`,
    receiptNo: `RCP-${M.TODAY.getFullYear()}-${String(n).padStart(5, '0')}`,
    studentId, amount, mode, reference, remark, at: new Date(), by, status: 'Valid',
  };
  M.payments.push(p);
  const s = M.studentById(studentId);
  log(by, 'PAYMENT_CREATED', 'Payment', p.receiptNo, `Collected ₹${amount.toLocaleString('en-IN')} from ${s.name} (${mode})`);
  emit();
  return p;
}

export function nextStudentId() {
  const used = [...M.students.map((s) => s.id), ...M.payments.map((p) => p.studentId)];
  const last = Math.max(0, ...used.map((id) => Number(id.split('-').pop()) || 0));
  return `UC-${M.TODAY.getFullYear()}-${String(last + 1).padStart(4, '0')}`;
}

export function admitStudent(input: Omit<Student, 'id' | 'installments' | 'lastReminded' | 'status' | 'admissionDate'> & { initial: number; installments: number; firstDue: Date; mode: PayMode }, by: string) {
  if (!M.courses.some((c) => c.id === input.courseId && c.active)) throw new Error('Choose an active course.');
  if (!M.batches.some((b) => b.id === input.batchId && b.courseId === input.courseId && b.status !== 'Completed')) throw new Error('Choose a valid time slot for the course.');
  if (input.subtypeId && !M.courseSubtypes.some((s) => s.id === input.subtypeId && s.courseId === input.courseId && s.active)) throw new Error('Choose a sub-type of the selected course.');
  if (!Number.isFinite(input.courseFee) || !Number.isFinite(input.discount) || input.discount < 0 || input.discount > input.courseFee) throw new Error('Invalid course fee or discount.');
  if (input.enquiryId) {
    const enquiry = M.enquiries.find((e) => e.id === input.enquiryId);
    if (!enquiry || enquiry.status === 'Converted' || enquiry.studentId || M.students.some((s) => s.enquiryId === input.enquiryId)) throw new Error('This enquiry is already converted or unavailable.');
    if (enquiry.courseId && enquiry.courseId !== input.courseId) throw new Error('The admission course must match the enquiry.');
  }
  if (input.installments < 0 || input.installments > 8 || !Number.isInteger(input.installments)) throw new Error('Choose up to eight installments.');
  if (input.initial < 0 || input.initial > input.courseFee - input.discount) throw new Error('Invalid initial payment.');
  if ((input.courseFee - input.discount - input.initial > 0) !== (input.installments > 0)) throw new Error('Set installments for the outstanding balance.');
  if (input.installments > 0 && Number.isNaN(input.firstDue.getTime())) throw new Error('Choose a valid first due date.');
  const id = nextStudentId();
  const net = input.courseFee - input.discount;
  const rest = net - input.initial;
  const per = input.installments ? Math.floor(rest / input.installments / 50) * 50 : 0;
  const insts = [{ no: 0, due: new Date(M.TODAY), amount: input.initial, paid: input.initial }];
  let alloc = input.initial;
  for (let k = 1; k <= input.installments; k++) {
    const amt = k === input.installments ? net - alloc : per;
    alloc += amt;
    const due = addMonthsClamped(input.firstDue, k - 1);
    insts.push({ no: k, due, amount: amt, paid: 0 });
  }
  const { initial, installments, firstDue, mode, ...rest2 } = input;
  void installments; void firstDue;
  const s: Student = { ...rest2, id, installments: insts, lastReminded: null, status: 'Active', admissionDate: new Date() };
  M.students.push(s);
  if (input.enquiryId) {
    const enquiry = M.enquiries.find((e) => e.id === input.enquiryId)!;
    enquiry.status = 'Converted';
    enquiry.studentId = id;
    enquiry.handledBy = by;
    enquiry.activity.push({ at: new Date(), by, action: 'Admission confirmed', status: 'Converted', note: `Student ${id} created` });
    log(by, 'ENQUIRY_CONVERTED', 'Enquiry', enquiry.id, `${enquiry.id} converted to ${id}`);
  }
  log(by, 'STUDENT_CREATED', 'Student', id, `Admission confirmed — ${s.name} (${M.courseById(s.courseId).code})`);
  let payment: Payment | undefined;
  if (initial > 0) payment = collectFee(id, initial, mode, '', 'Admission payment', by);
  emit();
  return { student: s, payment };
}

export function createEnquiry(input: Pick<Enquiry, 'name' | 'phone' | 'fatherName' | 'email' | 'address' | 'aadhaar' | 'reference' | 'courseId' | 'subtypeId'>, by: string) {
  if (!input.name.trim() || !/^[6-9]\d{9}$/.test(input.phone.replace(/\D/g, ''))) throw new Error('Name and a valid mobile number are required.');
  if (input.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) throw new Error('Enter a valid email address.');
  if (input.courseId && !M.courses.some((c) => c.id === input.courseId && c.active)) throw new Error('Choose an active course.');
  if (input.aadhaar && !/^\d{12}$/.test(input.aadhaar.replace(/\D/g, ''))) throw new Error('Aadhaar must contain 12 digits when provided.');
  if (input.subtypeId && !M.courseSubtypes.some((s) => s.id === input.subtypeId && s.courseId === input.courseId && s.active)) throw new Error('Choose a sub-type of the selected course.');
  const id = `EQ-${M.TODAY.getFullYear()}-${String(M.enquiries.length + 1).padStart(4, '0')}`;
  const enquiry: Enquiry = { ...input, id, status: 'New', handledBy: by, createdAt: new Date(), activity: [{ at: new Date(), by, action: 'Enquiry created', status: 'New', note: '' }] };
  M.enquiries.unshift(enquiry);
  log(by, 'ENQUIRY_CREATED', 'Enquiry', id, `Enquiry created for ${input.name}`);
  emit();
  return enquiry;
}

export function updateEnquiry(id: string, status: Exclude<EnquiryStatus, 'Converted'>, note: string, by: string) {
  const enquiry = M.enquiries.find((e) => e.id === id);
  if (!enquiry || enquiry.status === 'Converted') throw new Error('Converted enquiries cannot be changed.');
  const before = enquiry.status;
  enquiry.status = status;
  enquiry.handledBy = by;
  enquiry.activity.push({ at: new Date(), by, action: 'Status updated', status, note: note.trim() });
  log(by, 'ENQUIRY_UPDATED', 'Enquiry', id, `${before} → ${status}`, { status: before }, { status });
  emit();
}

export function addExpense(e: Omit<Expense, 'id'>) {
  const x: Expense = { ...e, id: `EX-${String(M.expenses.length + 1).padStart(4, '0')}` };
  M.expenses.unshift(x);
  log(e.by, 'EXPENSE_CREATED', 'Expense', x.id, `${e.category} — ₹${e.amount.toLocaleString('en-IN')}`);
  emit();
  return x;
}

export function setJobStatus(jobId: string, status: JobStatus, note: string, by: string) {
  const j = M.jobById(jobId);
  const before = j.status;
  j.status = status;
  j.history.push({ at: new Date(), by, status, note: note || undefined });
  log(by, 'JOB_STATUS_CHANGED', 'Service Job', jobId, `${jobId}: ${before} → ${status}`, { status: before }, { status });
  emit();
}

export function uploadDoc(jobId: string, docName: string, by: string) {
  const j = M.jobById(jobId);
  const d = j.docs.find((x) => x.name === docName);
  if (d) {
    d.uploaded = true;
    d.file = `${docName.toLowerCase().replace(/[^a-z0-9]+/g, '_')}.pdf`;
    d.size = '842 KB';
  }
  j.history.push({ at: new Date(), by, status: 'Document', note: `${docName} uploaded` });
  log(by, 'DOCUMENT_UPLOADED', 'Service Job', jobId, `${docName} uploaded to ${jobId}`);
  emit();
}

export function createBill(jobId: string, items: BillItem[], discount: number, by: string): Bill {
  const j = M.jobById(jobId);
  const last = M.bills.reduce((m, b) => Math.max(m, parseInt(b.id.split('-')[2], 10)), 300);
  const b: Bill = { id: `SB-${M.TODAY.getFullYear()}-${String(last + 1).padStart(4, '0')}`, jobId, customerId: j.customerId, items, discount, status: 'Unpaid', createdAt: new Date(), by };
  M.bills.push(b);
  j.billId = b.id;
  log(by, 'BILL_CREATED', 'Service Bill', b.id, `Bill ${b.id} created for ${jobId} — ₹${M.billTotal(b).toLocaleString('en-IN')}`);
  emit();
  return b;
}

export function payBill(billId: string, mode: PayMode, by: string) {
  const b = M.billById(billId);
  b.status = 'Paid';
  b.mode = mode;
  b.paidAt = new Date();
  log(by, 'BILL_PAID', 'Service Bill', billId, `Full payment ₹${M.billTotal(b).toLocaleString('en-IN')} received (${mode})`, { status: 'Unpaid' }, { status: 'Paid' });
  emit();
}

export function cancelBill(billId: string, reason: string, by: string) {
  const b = M.billById(billId);
  const before = b.status;
  b.status = 'Cancelled';
  b.cancelReason = reason;
  log(by, 'BILL_CANCELLED', 'Service Bill', billId, `Bill cancelled — ${reason}`, { status: before }, { status: 'Cancelled' });
  emit();
}

export function addCustomer(c: Omit<Customer, 'id' | 'createdAt'>, by: string) {
  const x: Customer = { ...c, id: `CU-${String(M.customers.length + 1).padStart(4, '0')}`, createdAt: new Date() };
  M.customers.unshift(x);
  log(by, 'CUSTOMER_CREATED', 'Customer', x.id, `New customer — ${x.name}`);
  emit();
  return x;
}

export function markReminded(studentId: string) {
  M.studentById(studentId).lastReminded = new Date();
  emit();
}

export function touch() {
  emit();
}
