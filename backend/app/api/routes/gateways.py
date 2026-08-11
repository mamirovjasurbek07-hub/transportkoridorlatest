import uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from geoalchemy2.functions import ST_SetSRID, ST_MakePoint
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import admin_user, csrf_protect
from app.models import CountryGateway, User
from app.audit import add_audit

router = APIRouter(prefix="/gateways", tags=["country-gateways"])


class GatewayInput(BaseModel):
    country_code: str = Field(min_length=2, max_length=2)
    name: str = Field(min_length=2, max_length=255)
    gateway_type: str = Field(min_length=2, max_length=40)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    neighbor_country_code: str | None = Field(default=None, min_length=2, max_length=2)
    verified: bool = False
    is_active: bool = True
    notes: str | None = None


def payload(item: CountryGateway) -> dict:
    return {"id": str(item.id), "country_code": item.country_code, "name": item.name, "gateway_type": item.gateway_type,
        "latitude": item.latitude, "longitude": item.longitude, "neighbor_country_code": item.neighbor_country_code,
        "verified": item.verified, "is_active": item.is_active, "notes": item.notes}


@router.get("")
async def list_gateways(country: str | None = None, db: AsyncSession = Depends(get_db), _: User = Depends(admin_user)) -> list[dict]:
    query = select(CountryGateway).order_by(CountryGateway.country_code, CountryGateway.name)
    if country:
        query = query.where(CountryGateway.country_code == country.upper())
    return [payload(item) for item in (await db.scalars(query)).all()]


@router.post("", status_code=201, dependencies=[Depends(csrf_protect)])
async def create_gateway(data: GatewayInput, request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(admin_user)) -> dict:
    values = data.model_dump()
    values["country_code"] = values["country_code"].upper()
    if values["neighbor_country_code"]:
        values["neighbor_country_code"] = values["neighbor_country_code"].upper()
    item = CountryGateway(**values)
    item.location = ST_SetSRID(ST_MakePoint(item.longitude, item.latitude), 4326)
    db.add(item)
    await db.flush()
    await add_audit(db, request, user, "CREATE", "country_gateway", str(item.id), after=values)
    await db.commit()
    await db.refresh(item)
    return payload(item)


@router.put("/{gateway_id}", dependencies=[Depends(csrf_protect)])
async def update_gateway(gateway_id: uuid.UUID, data: GatewayInput, request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(admin_user)) -> dict:
    item = await db.get(CountryGateway, gateway_id)
    if not item:
        raise HTTPException(status_code=404, detail="Gateway topilmadi")
    before = payload(item)
    for key, value in data.model_dump().items():
        setattr(item, key, value)
    item.location = ST_SetSRID(ST_MakePoint(item.longitude, item.latitude), 4326)
    await add_audit(db, request, user, "UPDATE", "country_gateway", str(item.id), before=before, after=data.model_dump())
    await db.commit()
    return payload(item)


@router.delete("/{gateway_id}", dependencies=[Depends(csrf_protect)])
async def deactivate_gateway(gateway_id: uuid.UUID, request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(admin_user)) -> dict:
    item = await db.get(CountryGateway, gateway_id)
    if not item:
        raise HTTPException(status_code=404, detail="Gateway topilmadi")
    item.is_active = False
    await add_audit(db, request, user, "DEACTIVATE", "country_gateway", str(item.id))
    await db.commit()
    return {"message": "Gateway nofaol qilindi"}
