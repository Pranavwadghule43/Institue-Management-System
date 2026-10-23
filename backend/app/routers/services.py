"""Customers (separate from students) and the Service Master (categories + services)."""
from fastapi import APIRouter, Depends
from pydantic import Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..common import In, Mobile, Money, OptMobile, OptStr, OptText, Paging, Str, apply_changes, audit, like, local_date, money, next_code, paginate, paging
from ..db import get_db
from ..errors import bad, conflict, not_found
from ..models import Customer, Service, ServiceBill, ServiceCategory, ServiceJob
from ..security import CurrentUser, get_current_user, require

router = APIRouter(tags=["customers & service master"])
manage_master = require("service_master.manage")

# ----------------------------------------------------------------- customers


class CustomerIn(In):
    full_name: Str(160)
    mobile: Mobile
    whatsapp_number: OptMobile = None  # omitted -> same as mobile
    address: OptText = None


class CustomerPatch(In):
    full_name: Str(160) | None = None
    mobile: Mobile | None = None
    whatsapp_number: OptMobile = None
    address: OptText = None


def get_customer(db: Session, code: str) -> Customer:
    c = db.scalars(select(Customer).where(Customer.customer_code == code, Customer.deleted_at.is_(None))).first()
    if c is None:
        raise not_found("customer")
    return c


def _stats():
    jobs = select(ServiceJob.customer_id.label("cid"), func.count().label("jobs"), func.max(ServiceJob.service_date).label("last")).group_by(ServiceJob.customer_id).subquery()
    paid = select(ServiceBill.customer_id.label("cid"), func.sum(ServiceBill.grand_total).label("paid")).where(ServiceBill.status == "Paid").group_by(ServiceBill.customer_id).subquery()
    unpaid = select(ServiceBill.customer_id.label("cid"), func.sum(ServiceBill.grand_total).label("unpaid")).where(ServiceBill.status == "Unpaid").group_by(ServiceBill.customer_id).subquery()
    return jobs, paid, unpaid


def customer_out(c: Customer, jobs=0, last=None, paid=None, unpaid=None) -> dict:
    return {"code": c.customer_code, "full_name": c.full_name, "mobile": c.mobile, "whatsapp_number": c.whatsapp_number or c.mobile,
            "address": c.address, "created_at": c.created_at, "updated_at": c.updated_at, "total_jobs": jobs or 0,
            "last_visit": last or (local_date(c.created_at) if c.created_at else None), "total_paid": money(paid or 0), "unpaid": money(unpaid or 0)}


def _customer_with_stats(db: Session, stmt):
    jobs, paid, unpaid = _stats()
    return (stmt.add_columns(jobs.c.jobs, jobs.c.last, paid.c.paid, unpaid.c.unpaid).outerjoin(jobs, jobs.c.cid == Customer.id)
            .outerjoin(paid, paid.c.cid == Customer.id).outerjoin(unpaid, unpaid.c.cid == Customer.id))


@router.get("/customers")
def list_customers(q: str | None = None, p: Paging = Depends(paging), db: Session = Depends(get_db), _: CurrentUser = Depends(require("customers.view"))):
    stmt = select(Customer).where(Customer.deleted_at.is_(None)).order_by(Customer.created_at.desc(), Customer.id.desc())
    if q:
        stmt = stmt.where(or_(Customer.full_name.ilike(like(q)), Customer.customer_code.ilike(like(q)), Customer.mobile.like(like(q.replace(" ", "")))))
    return paginate(db, _customer_with_stats(db, stmt), p, lambda r: customer_out(*r), scalars=False)


@router.post("/customers", status_code=201)
def create_customer(body: CustomerIn, db: Session = Depends(get_db), user: CurrentUser = Depends(require("customers.manage"))):
    # Mobile is not unique (not agreed by the DB/product owner): warn, don't block.
    dups = db.execute(select(Customer.customer_code, Customer.full_name).where(Customer.mobile == body.mobile, Customer.deleted_at.is_(None))).all()
    c = Customer(customer_code=next_code(db, "CUSTOMER"), full_name=body.full_name, mobile=body.mobile,
                 whatsapp_number=body.whatsapp_number or body.mobile, address=body.address)
    db.add(c)
    db.flush()
    audit(db, user.id, "CUSTOMER_CREATED", "Customer", c.customer_code, f"New customer - {c.full_name}")
    db.commit()
    return customer_out(c) | {"duplicate_mobile_of": [{"code": k, "full_name": n} for k, n in dups]}


@router.get("/customers/{code}")
def get_customer_api(code: str, db: Session = Depends(get_db), _: CurrentUser = Depends(require("customers.view"))):
    row = db.execute(_customer_with_stats(db, select(Customer).where(Customer.customer_code == code, Customer.deleted_at.is_(None)))).first()
    if row is None:
        raise not_found("customer")
    return customer_out(*row)


@router.patch("/customers/{code}")
def update_customer(code: str, body: CustomerPatch, db: Session = Depends(get_db), user: CurrentUser = Depends(require("customers.manage"))):
    c = get_customer(db, code)
    before, after = apply_changes(c, body.model_dump(exclude_unset=True))
    if after:
        audit(db, user.id, "CUSTOMER_UPDATED", "Customer", c.customer_code, f"Customer {c.full_name} updated", before, after)
    db.commit()
    return customer_out(c)


@router.get("/customers/{code}/history")
def customer_history(code: str, db: Session = Depends(get_db), _: CurrentUser = Depends(require("customers.view"))):
    c = get_customer(db, code)
    jobs = db.scalars(select(ServiceJob).where(ServiceJob.customer_id == c.id).order_by(ServiceJob.service_date.desc(), ServiceJob.id.desc())).all()
    bills = db.scalars(select(ServiceBill).where(ServiceBill.customer_id == c.id).order_by(ServiceBill.created_at.desc())).all()
    return {
        "jobs": [{"code": j.job_code, "services": [i.service.name for i in j.items], "application_name": j.application_name,
                  "service_date": j.service_date, "due_date": j.due_date, "status": j.status} for j in jobs],
        "bills": [{"code": b.bill_code, "job_code": b.job.job_code, "created_at": b.created_at, "grand_total": money(b.grand_total), "status": b.status} for b in bills],
        "total_paid": money(sum(b.grand_total for b in bills if b.status == "Paid")),
        "unpaid": money(sum(b.grand_total for b in bills if b.status == "Unpaid")),
    }


# ----------------------------------------------------------------- service categories


class CategoryIn(In):
    name: Str(160)


def _category(db: Session, cid: int) -> ServiceCategory:
    c = db.get(ServiceCategory, cid)
    if c is None:
        raise not_found("service category")
    return c


def _unique_name(db: Session, model, name: str, exclude: int | None = None):
    stmt = select(model.id).where(func.lower(model.name) == name.lower())
    if exclude:
        stmt = stmt.where(model.id != exclude)
    if db.scalar(stmt):
        raise conflict("CATEGORY_EXISTS", "A category with this name already exists.")


def category_out(c: ServiceCategory, services: int = 0) -> dict:
    return {"id": c.id, "name": c.name, "is_active": c.is_active, "services": services}


@router.get("/service-categories")
def list_categories(active: bool | None = None, db: Session = Depends(get_db), _: CurrentUser = Depends(get_current_user)):
    counts = dict(db.execute(select(Service.category_id, func.count()).group_by(Service.category_id)).all())
    stmt = select(ServiceCategory).order_by(ServiceCategory.name)
    if active is not None:
        stmt = stmt.where(ServiceCategory.is_active.is_(active))
    return [category_out(c, counts.get(c.id, 0)) for c in db.scalars(stmt)]


@router.post("/service-categories", status_code=201)
def create_category(body: CategoryIn, db: Session = Depends(get_db), user: CurrentUser = Depends(manage_master)):
    _unique_name(db, ServiceCategory, body.name)
    c = ServiceCategory(name=body.name, is_active=True)
    db.add(c)
    db.flush()
    audit(db, user.id, "SERVICE_CATEGORY_CREATED", "Service Category", str(c.id), f"Category {c.name} added")
    db.commit()
    return category_out(c)


@router.patch("/service-categories/{cid}")
def rename_category(cid: int, body: CategoryIn, db: Session = Depends(get_db), user: CurrentUser = Depends(manage_master)):
    c = _category(db, cid)
    _unique_name(db, ServiceCategory, body.name, c.id)
    before, after = apply_changes(c, {"name": body.name})
    if after:
        audit(db, user.id, "SERVICE_CATEGORY_UPDATED", "Service Category", str(c.id), f"Category renamed to {c.name}", before, after)
    db.commit()
    return category_out(c)


def _toggle(db: Session, obj, active: bool, user: CurrentUser, action: str, entity: str, ref: str, label: str):
    if obj.is_active != active:
        obj.is_active = active
        audit(db, user.id, f"{action}_{'ACTIVATED' if active else 'DEACTIVATED'}", entity, ref, f"{label} {'activated' if active else 'deactivated'}")
    db.commit()


@router.post("/service-categories/{cid}/activate")
def activate_category(cid: int, db: Session = Depends(get_db), user: CurrentUser = Depends(manage_master)):
    c = _category(db, cid)
    _toggle(db, c, True, user, "SERVICE_CATEGORY", "Service Category", str(c.id), c.name)
    return category_out(c)


@router.post("/service-categories/{cid}/deactivate")
def deactivate_category(cid: int, db: Session = Depends(get_db), user: CurrentUser = Depends(manage_master)):
    c = _category(db, cid)
    _toggle(db, c, False, user, "SERVICE_CATEGORY", "Service Category", str(c.id), c.name)
    return category_out(c)


@router.delete("/service-categories/{cid}", status_code=204)
def delete_category(cid: int, db: Session = Depends(get_db), user: CurrentUser = Depends(manage_master)):
    c = _category(db, cid)
    if db.scalar(select(func.count()).where(Service.category_id == c.id)):
        raise conflict("CATEGORY_IN_USE", "This category has services, so it can only be deactivated.")
    audit(db, user.id, "SERVICE_CATEGORY_DELETED", "Service Category", str(c.id), f"Category {c.name} deleted")
    db.delete(c)
    db.commit()


# ----------------------------------------------------------------- services


class ServiceIn(In):
    name: Str(160)
    category_id: int
    price: Money
    service_code: OptStr(40) = None
    cost: Money | None = None
    estimated_minutes: int | None = Field(None, ge=0, le=100000)


class ServicePatch(In):
    name: Str(160) | None = None
    category_id: int | None = None
    price: Money | None = None
    service_code: OptStr(40) = None
    cost: Money | None = None
    estimated_minutes: int | None = Field(None, ge=0, le=100000)


def service_out(s: Service, user: CurrentUser) -> dict:
    out = {"id": s.id, "code": s.service_code, "name": s.name, "category": {"id": s.category.id, "name": s.category.name},
           "price": money(s.customer_price), "estimated_minutes": s.estimated_minutes, "is_active": s.is_active}
    if user.can("service_master.manage"):
        out["cost"] = money(s.service_cost)
    return out


def _service(db: Session, sid: int) -> Service:
    s = db.get(Service, sid)
    if s is None:
        raise not_found("service")
    return s


def _columns(data: dict) -> dict:
    if "price" in data:
        data["customer_price"] = data.pop("price")
    if "cost" in data:
        data["service_cost"] = data.pop("cost")
    return data


@router.get("/services")
def list_services(category_id: int | None = None, active: bool | None = None, q: str | None = None,
                  db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user)):
    stmt = select(Service).join(ServiceCategory).order_by(ServiceCategory.name, Service.name)
    if category_id:
        stmt = stmt.where(Service.category_id == category_id)
    if active is not None:
        stmt = stmt.where(Service.is_active.is_(active))
    if q:
        stmt = stmt.where(or_(Service.name.ilike(like(q)), ServiceCategory.name.ilike(like(q))))
    return [service_out(s, user) for s in db.scalars(stmt)]


@router.get("/services/{sid}")
def get_service(sid: int, db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user)):
    return service_out(_service(db, sid), user)


@router.post("/services", status_code=201)
def create_service(body: ServiceIn, db: Session = Depends(get_db), user: CurrentUser = Depends(manage_master)):
    cat = _category(db, body.category_id)
    if not cat.is_active:
        raise bad("CATEGORY_INACTIVE", "Choose an active category.", "category_id")
    s = Service(**_columns(body.model_dump()), is_active=True)
    db.add(s)
    db.flush()
    audit(db, user.id, "SERVICE_CREATED", "Service", str(s.id), f"Service {s.name} added at {money(s.customer_price)}")
    db.commit()
    return service_out(s, user)


@router.patch("/services/{sid}")
def update_service(sid: int, body: ServicePatch, db: Session = Depends(get_db), user: CurrentUser = Depends(manage_master)):
    s = _service(db, sid)
    data = _columns(body.model_dump(exclude_unset=True))
    if "category_id" in data:
        _category(db, data["category_id"])
    if data.get("customer_price", 0) is None:
        raise bad("FIELD_REQUIRED", "Price is required.", "price")
    before, after = apply_changes(s, data)
    if "customer_price" in after:  # rate changes affect new bills only; existing lines keep their snapshot
        audit(db, user.id, "SERVICE_RATE_UPDATED", "Service", str(s.id), f"{s.name} price updated",
              {"price": before.pop("customer_price")}, {"price": after.pop("customer_price")})
    if after:
        audit(db, user.id, "SERVICE_UPDATED", "Service", str(s.id), f"{s.name} updated", before, after)
    db.commit()
    db.refresh(s)
    return service_out(s, user)


@router.post("/services/{sid}/activate")
def activate_service(sid: int, db: Session = Depends(get_db), user: CurrentUser = Depends(manage_master)):
    s = _service(db, sid)
    _toggle(db, s, True, user, "SERVICE", "Service", str(s.id), s.name)
    return service_out(s, user)


@router.post("/services/{sid}/deactivate")
def deactivate_service(sid: int, db: Session = Depends(get_db), user: CurrentUser = Depends(manage_master)):
    s = _service(db, sid)
    _toggle(db, s, False, user, "SERVICE", "Service", str(s.id), s.name)
    return service_out(s, user)
