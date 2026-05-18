from typing import Optional

from beanie import Indexed

from app.common.models import BaseDocument


class Tenant(BaseDocument):
    tenant_id: Indexed(str, unique=True)
    name: str
    is_active: bool = True
    s3_bucket_name: Optional[str] = None  # Override bucket name; defaults to {prefix}-{tenant_id}
    db_name: Optional[str] = None  # Override DB name; defaults to {prefix}_{tenant_id}

    class Settings:
        collection = "tenants"
        use_state_management = True
