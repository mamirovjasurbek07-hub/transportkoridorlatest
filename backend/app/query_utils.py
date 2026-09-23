def contains_pattern(value: str) -> str:
    """Build a literal SQL LIKE contains pattern; wildcard input stays literal."""
    escaped = value.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"
