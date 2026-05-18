"""ai_call_cache helper using asyncpg.

The connection pool is opened in main.py lifespan and stored on app.state.db_pool.
"""

import hashlib
import json
from typing import Any

import asyncpg


def hash_input(data: Any) -> str:
    serialized = json.dumps(data, sort_keys=True, default=str)
    return hashlib.sha256(serialized.encode()).hexdigest()


async def get_cached(
    pool: asyncpg.Pool,
    task: str,
    prompt_version: str,
    model: str,
    input_hash: str,
) -> dict | None:
    row = await pool.fetchrow(
        '''
        SELECT "responseJson" FROM "AiCallCache"
        WHERE task = $1 AND "promptVersion" = $2 AND model = $3 AND "inputHash" = $4
        ''',
        task, prompt_version, model, input_hash,
    )
    if row is None:
        return None
    return json.loads(row['responseJson'])


async def set_cached(
    pool: asyncpg.Pool,
    task: str,
    prompt_version: str,
    model: str,
    input_hash: str,
    response: dict,
    traced_to: str | None = None,
) -> None:
    await pool.execute(
        '''
        INSERT INTO "AiCallCache" (id, task, "promptVersion", model, "inputHash", "responseJson", "tracedTo", "createdAt")
        VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5::jsonb, $6, now())
        ON CONFLICT (task, "promptVersion", model, "inputHash") DO NOTHING
        ''',
        task, prompt_version, model, input_hash, json.dumps(response), traced_to,
    )
