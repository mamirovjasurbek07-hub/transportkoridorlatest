from fastapi import APIRouter

from app.api.routes import analytics, auth, corridors, gateways, posts, system

api_router = APIRouter()
api_router.include_router(system.router)
api_router.include_router(auth.router)
api_router.include_router(gateways.router)
api_router.include_router(posts.router)
api_router.include_router(corridors.router)
api_router.include_router(analytics.router)
