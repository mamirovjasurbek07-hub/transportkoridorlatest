import pytest
from pydantic import ValidationError

from app.schemas import PostCreate
from app.routing import RoutingService


def test_post_code_keeps_leading_zeroes():
    post = PostCreate(post_code="00101", post_name="Toshkent aeroporti", post_type="AERO")
    assert post.post_code == "00101"


def test_chbp_requires_neighbor_country():
    with pytest.raises(ValidationError):
        PostCreate(post_code="03002", post_name="Do'stlik", post_type="CHBP")


def test_coordinates_are_validated():
    with pytest.raises(ValidationError):
        PostCreate(post_code="00101", post_name="Aeroport", post_type="AERO", latitude=120, longitude=69)


def test_cache_key_is_stable_and_order_sensitive():
    a = [{"longitude": 69.1234567, "latitude": 41.1234567}, {"longitude": 68.0, "latitude": 40.0}]
    b = list(reversed(a))
    assert RoutingService._hash(a) == RoutingService._hash(a)
    assert RoutingService._hash(a) != RoutingService._hash(b)
