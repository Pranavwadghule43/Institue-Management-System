export type Role = 'Admin' | 'Staff';
export type PayMode = 'Cash' | 'GPay' | 'PhonePe' | 'UPI' | 'Card' | 'Bank';
export type StudentStatus = 'Active' | 'Completed' | 'Left';
export type JobStatus = 'Pending' | 'In Process' | 'On Hold' | 'Completed' | 'Cancelled';
export type Priority = 'Normal' | 'High' | 'Urgent';
export type BillStatus = 'Paid' | 'Unpaid' | 'Cancelled';

export interface Staff {
  id: string;
  name: string;
  username: string;
  role: Role;
  phone: string;
  status: 'Active' | 'Disabled' | 'Locked';
  lastLogin: Date | null;
  designation: string;
}

export interface Course {
  id: string;
  code: string;
  name: string;
  duration: number; // months
  fee: number;
  description: string;
  active: boolean;
}

export interface Batch {
  id: string;
  name: string;
  courseId: string;
  timing: string;
  days: string;
  teacher: string;
  capacity: number;
  start: Date;
  end: Date;
  status: 'Running' | 'Upcoming' | 'Completed';
}

export interface Installment {
  no: number;
  due: Date;
  amount: number;
  paid: number;
}

export interface Student {
  id: string;
  name: string;
  fatherName: string;
  gender: 'Male' | 'Female';
  dob: Date;
  phone: string;
  email: string;
  address: string;
  aadhaar: string;
  courseId: string;
  batchId: string;
  admissionDate: Date;
  courseFee: number;
  discount: number;
  status: StudentStatus;
  installments: Installment[];
  lastReminded: Date | null;
}

export interface Payment {
  id: string;
  receiptNo: string;
  studentId: string;
  amount: number;
  mode: PayMode;
  reference: string;
  at: Date;
  by: string; // staff id
  status: 'Valid' | 'Reversed';
  remark?: string;
}

export interface Customer {
  id: string;
  name: string;
  mobile: string;
  whatsapp: string;
  address: string;
  createdAt: Date;
}

export interface ServiceCategory {
  id: string;
  name: string;
}

export interface Service {
  id: string;
  name: string;
  categoryId: string;
  price: number;
  docs: string[];
  active: boolean;
}

export interface JobDoc {
  name: string;
  uploaded: boolean;
  file?: string;
  size?: string;
  sensitive?: boolean;
}

export interface JobEvent {
  at: Date;
  by: string;
  status: JobStatus | 'Created' | 'Note' | 'Assigned' | 'Document';
  note?: string;
}

export interface Job {
  id: string;
  customerId: string;
  serviceIds: string[];
  formName: string;
  serviceDate: Date;
  lastDate: Date;
  priority: Priority;
  assignees: string[];
  status: JobStatus;
  docs: JobDoc[];
  history: JobEvent[];
  billId?: string;
}

export interface BillItem {
  serviceId: string;
  qty: number;
  rate: number;
}

export interface Bill {
  id: string;
  jobId: string;
  customerId: string;
  items: BillItem[];
  discount: number;
  status: BillStatus;
  mode?: PayMode;
  createdAt: Date;
  paidAt?: Date;
  by: string;
  cancelReason?: string;
}

export interface Expense {
  id: string;
  date: Date;
  amount: number;
  category: string;
  remark: string;
  by: string;
  mode: PayMode;
  attachment?: string;
}

export interface AuditEntry {
  id: string;
  at: Date;
  actor: string;
  action: string;
  entity: string;
  entityId: string;
  summary: string;
  ip: string;
  before?: Record<string, string>;
  after?: Record<string, string>;
}

export interface Backup {
  id: string;
  at: Date;
  type: 'Daily (auto)' | 'Weekly (auto)' | 'Manual' | 'Pre-restore';
  size: string;
  status: 'Success' | 'Failed';
  verified: boolean;
}
