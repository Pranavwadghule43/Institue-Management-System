"""ORM mirror of the approved IMS schema (36 tables, owned by the DB lead).

Never call metadata.create_all() against the shared database. Tests use it on a
throwaway local Postgres only. tests/test_schema_drift.py checks these models
against the live schema.
"""
from datetime import date, datetime, time
from decimal import Decimal

from sqlalchemy import (
    JSON, BigInteger, Boolean, CheckConstraint, Date, DateTime, ForeignKey, ForeignKeyConstraint, Identity, Index, Integer,
    LargeBinary, Numeric, SmallInteger, String, Text, Time, UniqueConstraint, func, text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

MONEY = Numeric(12, 2)
JSONDOC = JSON().with_variant(JSONB(), "postgresql")


class Base(DeclarativeBase):
    pass


def pk():
    return mapped_column(BigInteger, Identity(), primary_key=True)


def fk(target: str, nullable: bool = True, **kw):
    return mapped_column(BigInteger, ForeignKey(target, **kw), nullable=nullable)


def created():
    return mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


def updated():
    return mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


def ts():
    return mapped_column(DateTime(timezone=True), nullable=True)


# ----------------------------------------------------------------- security / accounts

class AccountLimit(Base):
    __tablename__ = "account_limits"
    __table_args__ = (
        CheckConstraint("id = 1", name="account_limits_id_check"),
        CheckConstraint("max_admin = 1", name="account_limits_max_admin_check"),
        CheckConstraint("max_staff = 4", name="account_limits_max_staff_check"),
    )
    id: Mapped[int] = mapped_column(SmallInteger, primary_key=True, server_default=text("1"))
    max_admin: Mapped[int] = mapped_column(Integer, server_default=text("1"))
    max_staff: Mapped[int] = mapped_column(Integer, server_default=text("4"))
    updated_at: Mapped[datetime] = updated()


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint("role IN ('ADMIN', 'STAFF')", name="users_role_check"),
        Index("idx_users_role", "role"),
    )
    id: Mapped[int] = pk()
    username: Mapped[str] = mapped_column(String(100), unique=True)
    full_name: Mapped[str] = mapped_column(String(160))
    mobile: Mapped[str | None] = mapped_column(String(20))
    designation: Mapped[str | None] = mapped_column(String(120))
    role: Mapped[str] = mapped_column(String(12))
    password_hash: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))
    failed_attempts: Mapped[int] = mapped_column(Integer, server_default=text("0"))
    locked_until: Mapped[datetime | None] = ts()
    last_login_at: Mapped[datetime | None] = ts()
    created_at: Mapped[datetime] = created()
    updated_at: Mapped[datetime] = updated()
    deleted_at: Mapped[datetime | None] = ts()


class Permission(Base):
    __tablename__ = "permissions"
    id: Mapped[int] = pk()
    code: Mapped[str] = mapped_column(String(120), unique=True)
    description: Mapped[str | None] = mapped_column(Text)
    admin_only: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))


class UserPermission(Base):
    __tablename__ = "user_permissions"
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    permission_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("permissions.id", ondelete="CASCADE"), primary_key=True)
    granted_at: Mapped[datetime] = created()


class UserSession(Base):
    __tablename__ = "user_sessions"
    id: Mapped[int] = pk()
    user_id: Mapped[int] = fk("users.id", nullable=False)
    token_hash: Mapped[str] = mapped_column(String(200), unique=True)
    created_at: Mapped[datetime] = created()
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = ts()
    last_activity_at: Mapped[datetime | None] = ts()


class LoginAttempt(Base):
    __tablename__ = "login_attempts"
    id: Mapped[int] = pk()
    username: Mapped[str] = mapped_column(String(100))
    succeeded: Mapped[bool] = mapped_column(Boolean)
    attempted_at: Mapped[datetime] = created()
    ip_address: Mapped[str | None] = mapped_column(String(64))


# ----------------------------------------------------------------- settings / ids / files

class InstituteSettings(Base):
    __tablename__ = "institute_settings"
    __table_args__ = (CheckConstraint("id = 1", name="institute_settings_id_check"),)
    id: Mapped[int] = mapped_column(SmallInteger, primary_key=True, server_default=text("1"))
    name: Mapped[str | None] = mapped_column(String(180))
    tagline: Mapped[str | None] = mapped_column(String(255))
    address: Mapped[str | None] = mapped_column(Text)
    phone: Mapped[str | None] = mapped_column(String(30))
    email: Mapped[str | None] = mapped_column(String(255))
    fee_receipt_prefix: Mapped[str] = mapped_column(String(20), server_default=text("'RCP'"))
    service_bill_prefix: Mapped[str] = mapped_column(String(20), server_default=text("'SB'"))
    receipt_heading: Mapped[str | None] = mapped_column(String(255))
    receipt_footer: Mapped[str | None] = mapped_column(Text)
    service_bill_footer: Mapped[str | None] = mapped_column(Text)
    service_bill_account_note: Mapped[str | None] = mapped_column(Text)
    timezone: Mapped[str] = mapped_column(String(64), server_default=text("'Asia/Kolkata'"))
    updated_at: Mapped[datetime] = updated()


class NumberSequence(Base):
    __tablename__ = "number_sequences"
    __table_args__ = (
        UniqueConstraint("entity_type", "period_key", name="number_sequences_entity_type_period_key_key"),
        CheckConstraint("next_value > 0", name="number_sequences_next_value_check"),
        CheckConstraint("width >= 1 AND width <= 12", name="number_sequences_width_check"),
    )
    id: Mapped[int] = pk()
    entity_type: Mapped[str] = mapped_column(String(50))
    period_key: Mapped[str] = mapped_column(String(12), server_default=text("'GLOBAL'"))
    next_value: Mapped[int] = mapped_column(BigInteger)
    prefix: Mapped[str] = mapped_column(String(20))
    width: Mapped[int] = mapped_column(SmallInteger, server_default=text("4"))


class File(Base):
    __tablename__ = "files"
    __table_args__ = (CheckConstraint("size_bytes >= 0", name="files_size_bytes_check"),)
    id: Mapped[int] = pk()
    storage_key: Mapped[str] = mapped_column(String(300), unique=True)
    original_name: Mapped[str] = mapped_column(String(255))
    mime_type: Mapped[str] = mapped_column(String(120))
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    checksum: Mapped[str | None] = mapped_column(String(128))
    uploaded_by: Mapped[int | None] = fk("users.id")
    created_at: Mapped[datetime] = created()
    deleted_at: Mapped[datetime | None] = ts()


# ----------------------------------------------------------------- academics / admissions

class Course(Base):
    __tablename__ = "courses"
    __table_args__ = (CheckConstraint("fee >= 0", name="courses_fee_check"),)
    id: Mapped[int] = pk()
    code: Mapped[str] = mapped_column(String(32), unique=True)
    name: Mapped[str] = mapped_column(String(160))
    duration: Mapped[str | None] = mapped_column(String(80))
    fee: Mapped[Decimal] = mapped_column(MONEY, server_default=text("0"))
    description: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))
    created_at: Mapped[datetime] = created()
    updated_at: Mapped[datetime] = updated()
    deleted_at: Mapped[datetime | None] = ts()


class CourseSubtype(Base):
    __tablename__ = "course_subtypes"
    __table_args__ = (
        UniqueConstraint("course_id", "name", name="course_subtypes_course_id_name_key"),
        UniqueConstraint("course_id", "id", name="course_subtypes_course_id_id_key"),
        CheckConstraint("fee >= 0 AND fee <> 'NaN'::numeric", name="course_subtypes_fee_check"),
    )
    id: Mapped[int] = pk()
    course_id: Mapped[int] = fk("courses.id", nullable=False)
    name: Mapped[str] = mapped_column(String(150))
    fee: Mapped[Decimal | None] = mapped_column(MONEY)
    is_active: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))
    created_at: Mapped[datetime] = created()


class TimeSlot(Base):
    __tablename__ = "time_slots"
    __table_args__ = (
        CheckConstraint("capacity > 0", name="time_slots_capacity_check"),
        CheckConstraint("start_time >= '08:00:00' AND end_time <= '21:00:00' AND end_time > start_time", name="time_slots_check"),
        ForeignKeyConstraint(["course_id", "course_subtype_id"], ["course_subtypes.course_id", "course_subtypes.id"],
                             name="time_slots_course_subtype_fk"),
    )
    id: Mapped[int] = pk()
    course_id: Mapped[int] = fk("courses.id", nullable=False)
    course_subtype_id: Mapped[int | None] = mapped_column(BigInteger)
    name: Mapped[str] = mapped_column(String(120))
    start_time: Mapped[time] = mapped_column(Time)
    end_time: Mapped[time] = mapped_column(Time)
    days_of_week: Mapped[str] = mapped_column(String(100))
    faculty_name: Mapped[str | None] = mapped_column(String(140))
    capacity: Mapped[int] = mapped_column(Integer)
    start_date: Mapped[date | None] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)
    is_active: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))
    created_at: Mapped[datetime] = created()

    course: Mapped[Course] = relationship()
    course_subtype: Mapped[CourseSubtype | None] = relationship(viewonly=True)


class Enquiry(Base):
    __tablename__ = "enquiries"
    __table_args__ = (
        CheckConstraint("status IN ('New', 'Pending', 'Follow-Up', 'Converted')", name="enquiries_status_check"),
        Index("idx_enquiries_status_created", "status", "created_at"),
        Index("idx_enquiries_mobile", "mobile"),
    )
    id: Mapped[int] = pk()
    enquiry_code: Mapped[str] = mapped_column(String(40), unique=True)
    student_name: Mapped[str] = mapped_column(String(160))
    guardian_name: Mapped[str | None] = mapped_column(String(160))
    mobile: Mapped[str] = mapped_column(String(20))
    email: Mapped[str | None] = mapped_column(String(255))
    address: Mapped[str | None] = mapped_column(Text)
    reference: Mapped[str | None] = mapped_column(Text)
    aadhaar_ciphertext: Mapped[bytes | None] = mapped_column(LargeBinary)
    aadhaar_lookup_hash: Mapped[str | None] = mapped_column(String(128))
    aadhaar_last4: Mapped[str | None] = mapped_column(String(4))
    course_id: Mapped[int | None] = fk("courses.id")
    course_subtype_id: Mapped[int | None] = fk("course_subtypes.id")  # first chosen sub-type; full list in enquiry_course_subtypes
    status: Mapped[str] = mapped_column(String(20), server_default=text("'New'"))
    handling_staff_id: Mapped[int | None] = fk("users.id")
    created_by: Mapped[int | None] = fk("users.id")
    created_at: Mapped[datetime] = created()
    updated_at: Mapped[datetime] = updated()

    subtypes: Mapped[list[CourseSubtype]] = relationship(secondary="enquiry_course_subtypes", order_by="CourseSubtype.id")


class EnquiryActivity(Base):
    __tablename__ = "enquiry_activities"
    id: Mapped[int] = pk()
    enquiry_id: Mapped[int] = fk("enquiries.id", nullable=False)
    actor_id: Mapped[int | None] = fk("users.id")
    old_status: Mapped[str | None] = mapped_column(String(20))
    new_status: Mapped[str | None] = mapped_column(String(20))
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = created()


# 16 Nov (client): a student / enquiry can take several sub-types of the course (e.g. DCA: Advance excel + Tally).
class EnquiryCourseSubtype(Base):
    __tablename__ = "enquiry_course_subtypes"
    enquiry_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("enquiries.id", ondelete="CASCADE"), primary_key=True)
    course_subtype_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("course_subtypes.id"), primary_key=True)


class StudentCourseSubtype(Base):
    __tablename__ = "student_course_subtypes"
    student_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("students.id", ondelete="CASCADE"), primary_key=True)
    course_subtype_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("course_subtypes.id"), primary_key=True)


class Student(Base):
    __tablename__ = "students"
    __table_args__ = (
        CheckConstraint("agreed_fee >= 0", name="students_agreed_fee_check"),
        CheckConstraint("discount <= agreed_fee", name="students_check"),
        CheckConstraint("net_fee = agreed_fee - discount", name="students_check1"),
        CheckConstraint("discount >= 0", name="students_discount_check"),
        CheckConstraint("net_fee >= 0", name="students_net_fee_check"),
        CheckConstraint("status IN ('Active', 'Completed', 'Left')", name="students_status_check"),
        Index("idx_students_course_slot", "course_id", "time_slot_id"),
        Index("idx_students_mobile", "mobile"),
    )
    id: Mapped[int] = pk()
    student_code: Mapped[str] = mapped_column(String(40), unique=True)
    enquiry_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("enquiries.id"), unique=True)
    full_name: Mapped[str] = mapped_column(String(160))
    guardian_name: Mapped[str] = mapped_column(String(160))
    dob: Mapped[date] = mapped_column(Date)
    gender: Mapped[str | None] = mapped_column(String(40))
    mobile: Mapped[str] = mapped_column(String(20))
    whatsapp_number: Mapped[str | None] = mapped_column(String(20))
    email: Mapped[str | None] = mapped_column(String(255))
    address: Mapped[str] = mapped_column(Text)
    aadhaar_ciphertext: Mapped[bytes | None] = mapped_column(LargeBinary)
    aadhaar_lookup_hash: Mapped[str | None] = mapped_column(String(128))
    aadhaar_last4: Mapped[str | None] = mapped_column(String(4))
    education_qualification: Mapped[str | None] = mapped_column(String(200))
    photo_file_id: Mapped[int | None] = fk("files.id")
    course_id: Mapped[int] = fk("courses.id", nullable=False)
    course_subtype_id: Mapped[int | None] = fk("course_subtypes.id")
    time_slot_id: Mapped[int] = fk("time_slots.id", nullable=False)
    admission_date: Mapped[date] = mapped_column(Date)
    reference: Mapped[str | None] = mapped_column(Text)
    remark: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), server_default=text("'Active'"))
    agreed_fee: Mapped[Decimal] = mapped_column(MONEY)
    discount: Mapped[Decimal] = mapped_column(MONEY, server_default=text("0"))
    net_fee: Mapped[Decimal] = mapped_column(MONEY)
    created_by: Mapped[int | None] = fk("users.id")
    created_at: Mapped[datetime] = created()
    updated_at: Mapped[datetime] = updated()
    deleted_at: Mapped[datetime | None] = ts()

    course: Mapped[Course] = relationship()
    subtype: Mapped[CourseSubtype | None] = relationship()  # first chosen; kept in step for older readers
    subtypes: Mapped[list[CourseSubtype]] = relationship(secondary="student_course_subtypes", order_by="CourseSubtype.id")
    time_slot: Mapped[TimeSlot] = relationship()


class StudentTimeSlotHistory(Base):
    __tablename__ = "student_time_slot_history"
    id: Mapped[int] = pk()
    student_id: Mapped[int] = fk("students.id", nullable=False)
    old_time_slot_id: Mapped[int | None] = fk("time_slots.id")
    new_time_slot_id: Mapped[int] = fk("time_slots.id", nullable=False)
    changed_by: Mapped[int | None] = fk("users.id")
    reason: Mapped[str | None] = mapped_column(Text)
    changed_at: Mapped[datetime] = created()


# ----------------------------------------------------------------- student finance

class StudentInstallment(Base):
    __tablename__ = "student_installments"
    __table_args__ = (
        UniqueConstraint("student_id", "installment_no", name="student_installments_student_id_installment_no_key"),
        CheckConstraint("amount >= 0", name="student_installments_amount_check"),
        CheckConstraint("paid_amount <= amount", name="student_installments_check"),
        CheckConstraint("installment_no > 0", name="student_installments_installment_no_check"),
        CheckConstraint("paid_amount >= 0", name="student_installments_paid_amount_check"),
        Index("idx_installments_student_due", "student_id", "due_date"),
    )
    id: Mapped[int] = pk()
    student_id: Mapped[int] = fk("students.id", nullable=False)
    installment_no: Mapped[int] = mapped_column(Integer)
    due_date: Mapped[date] = mapped_column(Date)
    amount: Mapped[Decimal] = mapped_column(MONEY)
    paid_amount: Mapped[Decimal] = mapped_column(MONEY, server_default=text("0"))
    created_at: Mapped[datetime] = created()


class StudentPayment(Base):
    __tablename__ = "student_payments"
    __table_args__ = (
        CheckConstraint("amount > 0", name="student_payments_amount_check"),
        CheckConstraint("status IN ('Valid', 'Reversed')", name="student_payments_status_check"),
        Index("idx_payments_student_date", "student_id", "received_at"),
    )
    id: Mapped[int] = pk()
    student_id: Mapped[int] = fk("students.id", nullable=False)
    amount: Mapped[Decimal] = mapped_column(MONEY)
    payment_mode: Mapped[str] = mapped_column(String(30))
    payment_reference: Mapped[str | None] = mapped_column(String(150))
    remarks: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), server_default=text("'Valid'"))
    received_at: Mapped[datetime] = created()
    collected_by: Mapped[int | None] = fk("users.id")
    reversed_by: Mapped[int | None] = fk("users.id")
    reversed_at: Mapped[datetime | None] = ts()
    reversal_reason: Mapped[str | None] = mapped_column(Text)
    idempotency_key: Mapped[str | None] = mapped_column(String(120), unique=True)


class StudentPaymentAllocation(Base):
    __tablename__ = "student_payment_allocations"
    __table_args__ = (CheckConstraint("allocated_amount > 0", name="student_payment_allocations_allocated_amount_check"),)
    payment_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("student_payments.id"), primary_key=True)
    installment_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("student_installments.id"), primary_key=True)
    allocated_amount: Mapped[Decimal] = mapped_column(MONEY)


class FeeReceipt(Base):
    __tablename__ = "fee_receipts"
    id: Mapped[int] = pk()
    receipt_code: Mapped[str] = mapped_column(String(40), unique=True)
    payment_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("student_payments.id"), unique=True)
    student_id: Mapped[int] = fk("students.id", nullable=False)
    snapshot: Mapped[dict] = mapped_column(JSONDOC)
    next_payment_date_snapshot: Mapped[str] = mapped_column(String(40))
    issued_at: Mapped[datetime] = created()
    issued_by: Mapped[int | None] = fk("users.id")


class FeeReminderEvent(Base):
    __tablename__ = "fee_reminder_events"
    id: Mapped[int] = pk()
    student_id: Mapped[int] = fk("students.id", nullable=False)
    opened_by: Mapped[int | None] = fk("users.id")
    opened_at: Mapped[datetime] = created()
    channel: Mapped[str] = mapped_column(String(20), server_default=text("'WhatsApp'"))
    note: Mapped[str | None] = mapped_column(Text)


# ----------------------------------------------------------------- services

class Customer(Base):
    __tablename__ = "customers"
    id: Mapped[int] = pk()
    customer_code: Mapped[str] = mapped_column(String(40), unique=True)
    full_name: Mapped[str] = mapped_column(String(160))
    mobile: Mapped[str] = mapped_column(String(20))
    whatsapp_number: Mapped[str | None] = mapped_column(String(20))
    address: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = created()
    updated_at: Mapped[datetime] = updated()
    deleted_at: Mapped[datetime | None] = ts()


class ServiceCategory(Base):
    __tablename__ = "service_categories"
    id: Mapped[int] = pk()
    name: Mapped[str] = mapped_column(String(160), unique=True)
    is_active: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))
    created_at: Mapped[datetime] = created()


class Service(Base):
    __tablename__ = "services"
    __table_args__ = (
        CheckConstraint("customer_price >= 0", name="services_customer_price_check"),
        CheckConstraint("estimated_minutes >= 0", name="services_estimated_minutes_check"),
        CheckConstraint("service_cost IS NULL OR service_cost >= 0", name="services_service_cost_check"),
    )
    id: Mapped[int] = pk()
    service_code: Mapped[str | None] = mapped_column(String(40), unique=True)
    category_id: Mapped[int] = fk("service_categories.id", nullable=False)
    name: Mapped[str] = mapped_column(String(160))
    customer_price: Mapped[Decimal] = mapped_column(MONEY)
    service_cost: Mapped[Decimal | None] = mapped_column(MONEY)
    estimated_minutes: Mapped[int | None] = mapped_column(Integer)
    is_active: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))
    created_at: Mapped[datetime] = created()
    updated_at: Mapped[datetime] = updated()

    category: Mapped[ServiceCategory] = relationship()


class ServiceJob(Base):
    __tablename__ = "service_jobs"
    __table_args__ = (
        CheckConstraint("status IN ('Pending', 'In Process', 'On Hold', 'Completed', 'Cancelled')", name="service_jobs_status_check"),
        Index("idx_service_jobs_status_due", "status", "due_date"),
        Index("idx_service_jobs_customer", "customer_id"),
    )
    id: Mapped[int] = pk()
    job_code: Mapped[str] = mapped_column(String(40), unique=True)
    customer_id: Mapped[int] = fk("customers.id", nullable=False)
    application_name: Mapped[str | None] = mapped_column(String(200))
    service_date: Mapped[date] = mapped_column(Date)
    due_date: Mapped[date | None] = mapped_column(Date)
    notes: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), server_default=text("'Pending'"))
    priority: Mapped[str | None] = mapped_column(String(40))
    created_by: Mapped[int | None] = fk("users.id")
    created_at: Mapped[datetime] = created()
    updated_at: Mapped[datetime] = updated()
    completed_at: Mapped[datetime | None] = ts()

    customer: Mapped[Customer] = relationship()
    items: Mapped[list["ServiceJobItem"]] = relationship(order_by="ServiceJobItem.id")


class ServiceJobItem(Base):
    __tablename__ = "service_job_items"
    __table_args__ = (
        CheckConstraint("quantity > 0", name="service_job_items_quantity_check"),
        CheckConstraint("rate_snapshot >= 0", name="service_job_items_rate_snapshot_check"),
    )
    id: Mapped[int] = pk()
    job_id: Mapped[int] = fk("service_jobs.id", nullable=False)
    service_id: Mapped[int] = fk("services.id", nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, server_default=text("1"))
    rate_snapshot: Mapped[Decimal] = mapped_column(MONEY)

    service: Mapped[Service] = relationship()


class ServiceJobStaff(Base):
    __tablename__ = "service_job_staff"
    job_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("service_jobs.id"), primary_key=True)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"), primary_key=True)
    assigned_at: Mapped[datetime] = created()


class ServiceJobEvent(Base):
    __tablename__ = "service_job_events"
    id: Mapped[int] = pk()
    job_id: Mapped[int] = fk("service_jobs.id", nullable=False)
    old_status: Mapped[str | None] = mapped_column(String(20))
    new_status: Mapped[str] = mapped_column(String(20))
    reason: Mapped[str | None] = mapped_column(Text)
    actor_id: Mapped[int | None] = fk("users.id")
    created_at: Mapped[datetime] = created()


class ServiceJobDocument(Base):
    __tablename__ = "service_job_documents"
    id: Mapped[int] = pk()
    job_id: Mapped[int] = fk("service_jobs.id", nullable=False)
    file_id: Mapped[int] = fk("files.id", nullable=False)
    document_type: Mapped[str | None] = mapped_column(String(100))
    uploaded_by: Mapped[int | None] = fk("users.id")
    created_at: Mapped[datetime] = created()
    deleted_at: Mapped[datetime | None] = ts()

    file: Mapped[File] = relationship()


class ServiceBill(Base):
    __tablename__ = "service_bills"
    __table_args__ = (
        CheckConstraint("discount <= subtotal", name="service_bills_check"),
        CheckConstraint("grand_total = subtotal - discount", name="service_bills_check1"),
        CheckConstraint("discount >= 0", name="service_bills_discount_check"),
        CheckConstraint("grand_total >= 0", name="service_bills_grand_total_check"),
        CheckConstraint("status IN ('Unpaid', 'Paid', 'Cancelled')", name="service_bills_status_check"),
        CheckConstraint("subtotal >= 0", name="service_bills_subtotal_check"),
        Index("one_non_cancelled_bill_per_job", "job_id", unique=True, postgresql_where=text("status <> 'Cancelled'")),
        Index("idx_service_bills_status_date", "status", "paid_at"),
    )
    id: Mapped[int] = pk()
    bill_code: Mapped[str] = mapped_column(String(40), unique=True)
    job_id: Mapped[int] = fk("service_jobs.id", nullable=False)
    customer_id: Mapped[int] = fk("customers.id", nullable=False)
    subtotal: Mapped[Decimal] = mapped_column(MONEY, server_default=text("0"))
    discount: Mapped[Decimal] = mapped_column(MONEY, server_default=text("0"))
    grand_total: Mapped[Decimal] = mapped_column(MONEY, server_default=text("0"))
    status: Mapped[str] = mapped_column(String(20), server_default=text("'Unpaid'"))
    created_by: Mapped[int | None] = fk("users.id")
    paid_by: Mapped[int | None] = fk("users.id")
    paid_at: Mapped[datetime | None] = ts()
    cancelled_by: Mapped[int | None] = fk("users.id")
    cancelled_at: Mapped[datetime | None] = ts()
    cancellation_reason: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = created()
    updated_at: Mapped[datetime] = updated()

    job: Mapped[ServiceJob] = relationship()
    customer: Mapped[Customer] = relationship()
    items: Mapped[list["ServiceBillItem"]] = relationship(order_by="ServiceBillItem.id")


class ServiceBillItem(Base):
    __tablename__ = "service_bill_items"
    __table_args__ = (
        CheckConstraint("line_amount = quantity * rate", name="service_bill_items_check"),
        CheckConstraint("line_amount >= 0", name="service_bill_items_line_amount_check"),
        CheckConstraint("master_rate_snapshot >= 0", name="service_bill_items_master_rate_snapshot_check"),
        CheckConstraint("quantity > 0", name="service_bill_items_quantity_check"),
        CheckConstraint("rate >= 0", name="service_bill_items_rate_check"),
    )
    id: Mapped[int] = pk()
    bill_id: Mapped[int] = fk("service_bills.id", nullable=False)
    service_id: Mapped[int | None] = fk("services.id")
    service_name_snapshot: Mapped[str] = mapped_column(String(160))
    quantity: Mapped[int] = mapped_column(Integer)
    master_rate_snapshot: Mapped[Decimal] = mapped_column(MONEY)
    rate: Mapped[Decimal] = mapped_column(MONEY)
    line_amount: Mapped[Decimal] = mapped_column(MONEY)
    overridden_by: Mapped[int | None] = fk("users.id")


class ServicePayment(Base):
    __tablename__ = "service_payments"
    __table_args__ = (CheckConstraint("amount >= 0", name="service_payments_amount_check"),)
    id: Mapped[int] = pk()
    bill_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("service_bills.id"), unique=True)
    amount: Mapped[Decimal] = mapped_column(MONEY)
    payment_mode: Mapped[str] = mapped_column(String(30))
    reference: Mapped[str | None] = mapped_column(String(150))
    paid_by: Mapped[int | None] = fk("users.id")
    paid_at: Mapped[datetime] = created()
    idempotency_key: Mapped[str | None] = mapped_column(String(120), unique=True)


# ----------------------------------------------------------------- expenses / operations

class ExpenseCategory(Base):
    __tablename__ = "expense_categories"
    id: Mapped[int] = pk()
    name: Mapped[str] = mapped_column(String(160), unique=True)
    is_active: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))


class Expense(Base):
    __tablename__ = "expenses"
    __table_args__ = (
        CheckConstraint("amount > 0", name="expenses_amount_check"),
        Index("idx_expenses_date", "expense_date"),
    )
    id: Mapped[int] = pk()
    expense_code: Mapped[str] = mapped_column(String(40), unique=True)
    expense_date: Mapped[date] = mapped_column(Date)
    category_id: Mapped[int] = fk("expense_categories.id", nullable=False)
    amount: Mapped[Decimal] = mapped_column(MONEY)
    payment_mode: Mapped[str] = mapped_column(String(30))
    description: Mapped[str] = mapped_column(Text)
    created_by: Mapped[int | None] = fk("users.id")
    attachment_file_id: Mapped[int | None] = fk("files.id")
    created_at: Mapped[datetime] = created()
    updated_at: Mapped[datetime] = updated()
    deleted_at: Mapped[datetime | None] = ts()

    category: Mapped[ExpenseCategory] = relationship()


class AuditLog(Base):
    __tablename__ = "audit_logs"
    __table_args__ = (
        Index("idx_audit_created", "created_at"),
        Index("idx_audit_entity", "entity_type", "entity_id"),
    )
    id: Mapped[int] = pk()
    actor_id: Mapped[int | None] = fk("users.id")
    category: Mapped[str] = mapped_column(String(30), server_default=text("'Business'"))
    action: Mapped[str] = mapped_column(String(100))
    entity_type: Mapped[str] = mapped_column(String(100))
    entity_id: Mapped[str | None] = mapped_column(String(100))
    summary: Mapped[str | None] = mapped_column(Text)
    before_data: Mapped[dict | None] = mapped_column(JSONDOC)
    after_data: Mapped[dict | None] = mapped_column(JSONDOC)
    reason: Mapped[str | None] = mapped_column(Text)
    ip_address: Mapped[str | None] = mapped_column(String(64))
    user_agent: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = created()


class BackupRun(Base):
    __tablename__ = "backup_runs"
    id: Mapped[int] = pk()
    started_at: Mapped[datetime] = created()
    finished_at: Mapped[datetime | None] = ts()
    status: Mapped[str] = mapped_column(String(30), server_default=text("'Pending'"))
    storage_key: Mapped[str | None] = mapped_column(String(300))
    size_bytes: Mapped[int | None] = mapped_column(BigInteger)
    created_by: Mapped[int | None] = fk("users.id")
    error_message: Mapped[str | None] = mapped_column(Text)
