/* Shapes returned by the FastAPI backend (snake_case, money as "1500.00" strings, dates as ISO strings). */

export type Role = 'Admin' | 'Staff';
export type PayMode = 'Cash' | 'GPay' | 'PhonePe' | 'UPI' | 'Card' | 'Bank';
export type StudentStatus = 'Active' | 'Completed' | 'Left';
export type JobStatus = 'Pending' | 'In Process' | 'On Hold' | 'Completed' | 'Cancelled';
export type BillStatus = 'Paid' | 'Unpaid' | 'Cancelled';
export type EnquiryStatus = 'New' | 'Pending' | 'Follow-Up' | 'Converted';
export type FeeState = 'Fully Paid' | 'Overdue' | 'Due Today' | 'Due Tomorrow' | 'On Track';
export type InstState = 'Paid' | 'Partial' | 'Overdue' | 'Due Today' | 'Upcoming';
export type Money = string;

export interface Ref { id: number; name: string }

export interface Me { id: number; username: string; full_name: string; role: Role; designation: string | null; permissions: string[] }

export interface Course {
  id: number; code: string; name: string; duration_months: number | null; fee: Money; description: string | null; is_active: boolean;
  active_students?: number; time_slots?: number; subtypes?: SubtypeRef[];
}
export interface SubtypeRef extends Ref { fee: Money | null }
export interface Subtype extends SubtypeRef { course_id: number; is_active: boolean }
export interface TimeSlot {
  id: number; course_id: number; name: string; start_time: string; end_time: string; timing: string; days: string; faculty: string | null;
  course_subtype_id: number | null; course_subtype: Ref | null;
  capacity: number; start_date: string | null; end_date: string | null; is_active: boolean; status: 'Running' | 'Upcoming' | 'Completed';
  assigned_students?: number; seats_left?: number; course?: { id: number; code: string; name: string };
}

export interface Enquiry {
  code: string; student_name: string; guardian_name: string | null; mobile: string; email: string | null; address: string | null;
  reference: string | null; aadhaar_masked: string | null; course: { id: number; code: string; name: string } | null;
  course_subtype: { id: number; name: string } | null; course_subtypes: { id: number; name: string }[]; status: EnquiryStatus; handling_staff: Ref | null; created_by: Ref | null;
  student_code: string | null; created_at: string; updated_at: string;
}
export interface EnquiryActivity { at: string; by: Ref | null; action: string; old_status: string | null; status: string; note: string | null }

export interface StudentRow {
  code: string; full_name: string; guardian_name: string; mobile: string; whatsapp_number: string; course: { id: number; code: string; name: string };
  time_slot: { id: number; name: string }; admission_date: string; status: StudentStatus; net_fee: Money; paid: Money; balance: Money;
  paid_pct: number; fee_state: FeeState; next_due: { due_date: string; amount: Money } | null; aadhaar_masked: string | null; archived: boolean;
}
export interface Student {
  code: string; full_name: string; guardian_name: string; dob: string; gender: string | null; mobile: string; whatsapp_number: string | null;
  email: string | null; address: string; aadhaar_masked: string | null; education_qualification: string | null; reference: string | null;
  remark: string | null; status: StudentStatus; admission_date: string;
  course: { id: number; code: string; name: string; duration_months: number | null }; course_subtype: { id: number; name: string } | null; course_subtypes: { id: number; name: string }[];
  time_slot: { id: number; name: string; timing: string; days: string; faculty: string | null };
  agreed_fee: Money; discount: Money; net_fee: Money; archived: boolean; created_at: string; updated_at: string;
}
export interface ScheduleRow { no: number; label: string; due_date: string; amount: Money; paid: Money; state: InstState }
export interface FeeSummary {
  agreed_fee: Money; discount: Money; net_fee: Money; total_paid: Money; balance: Money; paid_pct: number; fee_state: FeeState;
  next_due: { due_date: string; amount: Money; label: string } | null; overdue_days: number; schedule: ScheduleRow[];
}
export interface Payment {
  id: number; receipt_no: string | null; student: { code: string; name: string }; amount: Money; mode: PayMode; mode_label: string;
  reference: string | null; remarks: string | null; status: 'Valid' | 'Reversed'; received_at: string; collected_by: Ref | null;
  reversed_by: Ref | null; reversed_at: string | null; reversal_reason: string | null;
}
export interface ReceiptSnapshot {
  receipt_no: string; issued_at: string; student: { code: string; name: string; guardian: string; mobile: string };
  course: { code: string; name: string }; course_subtype: string | null; time_slot: { name: string; timing: string; days: string };
  joining_date?: string; course_expiry_date?: string | null; installments?: { no: number; due_date: string; amount: Money }[]; total_course_fee?: Money;
  payment: { amount: Money; mode: PayMode; mode_label: string; reference: string | null; remarks: string | null; collected_by: string };
  amount_in_words: string; net_fee: Money; previous_paid: Money; total_paid: Money; balance: Money; next_payment_date: string;
  institute: { name: string | null; tagline: string | null; address: string | null; phone: string | null; email: string | null; receipt_heading: string; receipt_footer: string | null };
}
export interface Receipt {
  receipt_no: string; payment_id: number; issued_at: string; status: 'Valid' | 'Reversed'; reversed_at: string | null; reversal_reason: string | null;
  next_payment_date: string; snapshot: ReceiptSnapshot;
  send_to?: { name: string; whatsapp_number: string } | null; // live registered WhatsApp number (19 Nov)
}

export interface Customer {
  code: string; full_name: string; mobile: string; whatsapp_number: string; address: string | null; created_at: string; updated_at: string;
  total_jobs: number; last_visit: string | null; total_paid: Money; unpaid: Money; duplicate_mobile_of?: { code: string; full_name: string }[];
}
export interface ServiceCategory { id: number; name: string; is_active: boolean; services: number }
export interface Service {
  id: number; code: string | null; name: string; category: { id: number; name: string }; price: Money; estimated_minutes: number | null;
  is_active: boolean; cost?: Money | null;
}
export interface Job {
  code: string; customer: { code: string; name: string; mobile: string; whatsapp_number: string };
  services: { id: number; name: string; category: string; quantity: number; rate: Money }[]; application_name: string | null;
  service_date: string; due_date: string | null; status: JobStatus; priority: string | null; notes: string | null; assignees: Ref[];
  estimate: Money; amount: Money; bill: { code: string; status: BillStatus; grand_total: Money } | null; overdue: boolean; overdue_days: number;
  created_at: string; completed_at: string | null;
}
export interface JobEvent { at: string; type: 'Created' | 'Status' | 'Assigned' | 'Note' | 'Document'; old_status?: string | null; status: string | null; note: string | null; by: Ref | null }
export interface JobDocument {
  id: number; document_type: string | null; original_name: string; mime_type: string; size_bytes: number; sensitive: boolean; can_view: boolean;
  uploaded_by: Ref | null; created_at: string;
}
export interface BillLine {
  id: number; service_id: number | null; name: string; quantity: number; master_rate: Money; rate: Money; line_amount: Money; overridden: boolean;
  overridden_by: Ref | null;
}
export interface Bill {
  code: string; status: BillStatus; job: { code: string; status: JobStatus; application_name: string | null };
  customer: { code: string; name: string; mobile: string; whatsapp_number: string }; items: BillLine[]; units: number; subtotal: Money;
  discount: Money; grand_total: Money; amount_in_words: string; created_by: Ref | null; created_at: string; paid_by: Ref | null;
  paid_at: string | null; payment: { amount: Money; mode: PayMode; mode_label: string; reference: string | null } | null;
  cancelled_by: Ref | null; cancelled_at: string | null; cancellation_reason: string | null; replaces: string[];
  institute: { name: string | null; tagline: string | null; address: string | null; phone: string | null; bill_footer: string | null; account_note: string | null };
}
export interface BillRow { code: string; job_code: string; customer: string; items: number; created_at: string; paid_at: string | null; mode: PayMode | null; grand_total: Money; status: BillStatus }

export interface ExpenseCategory { id: number; name: string; is_active: boolean; expenses?: number }
export interface Expense {
  code: string; expense_date: string; amount: Money; category: { id: number; name: string }; payment_mode: PayMode; description: string;
  added_by: Ref | null; has_attachment: boolean; created_at: string; updated_at: string;
}

export interface Followup { code: string; name: string; mobile: string; whatsapp_number: string; course_code: string; due_date: string; installment_due: Money; balance: Money; overdue_days: number }
export interface AuditItem { at: string; action: string; summary: string | null; entity_type: string; entity_id: string | null; by: Ref | null }
export interface DayTotals { fees: Money; services: Money; expenses: Money; income: Money; net: Money }
export interface SeriesRow extends DayTotals { key: string; receipts: number; bills: number; partial?: boolean }

export interface StaffMember {
  id: number; username: string; full_name: string; role: Role; mobile: string | null; designation: string | null;
  status: 'Active' | 'Disabled' | 'Locked'; last_login_at: string | null; created_at: string; permissions?: string[];
}
export interface AccountLimit { admin_accounts: number; staff_used: number; staff_limit: number; staff_remaining: number }
export interface Settings {
  institute: { name: string | null; tagline: string | null; address: string | null; phone: string | null; email: string | null; timezone: string };
  receipts: {
    fee_receipt_prefix: string; service_bill_prefix: string; receipt_heading: string | null; receipt_footer: string | null;
    service_bill_footer: string | null; service_bill_account_note: string | null; next_receipt_preview: string; next_bill_preview: string;
  };
}
