import json
import secrets
from fastapi import Request, HTTPException
from fastapi.responses import HTMLResponse
import httpx
import base64
import os
import aioredis

from dotenv import load_dotenv

# Load environment variables from .env
load_dotenv()

# Fetch HubSpot credentials from .env
CLIENT_ID = os.getenv("HUBSPOT_CLIENT_ID")
CLIENT_SECRET = os.getenv("HUBSPOT_CLIENT_SECRET")
REDIRECT_URI = os.getenv("HUBSPOT_REDIRECT_URI")
SCOPE = "crm.objects.contacts.read"
TOKEN_URL = "https://api.hubapi.com/oauth/v1/token"
AUTHORIZATION_URL = "https://app.hubspot.com/oauth/authorize"


# Step 1: Generate the authorization URL
async def authorize_hubspot(user_id, org_id):
    # Generate a unique state to prevent CSRF
    state_data = {
        "state": secrets.token_urlsafe(32),
        "user_id": user_id,
        "org_id": org_id,
    }
    encoded_state = base64.urlsafe_b64encode(json.dumps(state_data).encode()).decode()

    auth_url = (
        f"{AUTHORIZATION_URL}?client_id={CLIENT_ID}"
        f"&redirect_uri={REDIRECT_URI}&scope={SCOPE}&state={encoded_state}"
    )
    return auth_url


# Step 2: Handle the OAuth2 callback
async def oauth2callback_hubspot(request: Request):
    if "error" in request.query_params:
        raise HTTPException(status_code=400, detail=request.query_params["error"])

    code = request.query_params.get("code")
    encoded_state = request.query_params.get("state")

    # Decode state and validate it
    state_data = json.loads(base64.urlsafe_b64decode(encoded_state.encode()).decode())

    async with httpx.AsyncClient() as client:
        response = await client.post(
            TOKEN_URL,
            data={
                "grant_type": "authorization_code",
                "client_id": CLIENT_ID,
                "client_secret": CLIENT_SECRET,
                "redirect_uri": REDIRECT_URI,
                "code": code,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        response.raise_for_status()

    token_data = response.json()

    # Save token_data (e.g., access_token, refresh_token) and associated user/org
    # Example: Save to Redis, a database, or another storage solution
    # store_credentials(user_id=state_data["user_id"], org_id=state_data["org_id"], credentials=token_data)

    return HTMLResponse("<html><script>window.close();</script></html>")


# Step 3: Retrieve saved credentials
async def get_hubspot_credentials(user_id, org_id):
    # Connect to Redis (replace with your Redis URL or connection settings)
    redis = await aioredis.from_url("redis://localhost", decode_responses=True)

    # Create a unique key for storing credentials
    redis_key = f"hubspot:credentials:{user_id}:{org_id}"

    # Fetch the credentials from Redis
    credentials = await redis.hgetall(redis_key)

    if not credentials:
        raise HTTPException(status_code=404, detail="HubSpot credentials not found.")

    # Example of expected credentials structure:
    # {
    #     "access_token": "your-access-token",
    #     "refresh_token": "your-refresh-token",
    #     "expires_in": 3600,
    #     "expires_at": "timestamp-when-token-expires"
    # }

    return credentials

# Step 4: Process HubSpot items into integration-specific metadata
async def create_integration_item_metadata_object(response_json):
    return [
        {
            "id": item["id"],
            "name": item.get("properties", {}).get("firstname", "Unknown"),
            "email": item.get("properties", {}).get("email", "Unknown"),
        }
        for item in response_json.get("results", [])
    ]


# Step 5: Fetch items from HubSpot (e.g., contacts)
async def get_items_hubspot(credentials):
    access_token = credentials["access_token"]
    async with httpx.AsyncClient() as client:
        response = await client.get(
            "https://api.hubapi.com/crm/v3/objects/contacts",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        response.raise_for_status()

    response_json = response.json()
    return await create_integration_item_metadata_object(response_json)
