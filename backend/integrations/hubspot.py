import datetime
import json
import secrets
from fastapi import Request, HTTPException
from fastapi.responses import HTMLResponse
import base64
import httpx
import asyncio

from integrations.integration_item import IntegrationItem
from redis_client import add_key_value_redis, get_value_redis, delete_key_redis

import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

CLIENT_ID = os.getenv("HUBSPOT_CLIENT_ID")
CLIENT_SECRET = os.getenv("HUBSPOT_CLIENT_SECRET")
REDIRECT_URI = os.getenv("HUBSPOT_REDIRECT_URI")

SCOPES = "crm.objects.contacts.read crm.objects.companies.read crm.objects.deals.read"
authorization_url = f"https://app.hubspot.com/oauth/authorize"

async def authorize_hubspot(user_id, org_id):
    """Initialize OAuth flow for HubSpot"""
    state_data = {
        'state': secrets.token_urlsafe(32),
        'user_id': user_id,
        'org_id': org_id
    }
    encoded_state = base64.urlsafe_b64encode(json.dumps(state_data).encode('utf-8')).decode('utf-8')
    
    # Store state in Redis for validation
    await add_key_value_redis(f'hubspot_state:{org_id}:{user_id}', json.dumps(state_data), expire=600)
    
    auth_url = (
        f"{authorization_url}"
        f"?client_id={CLIENT_ID}"
        f"&scope={SCOPES}"
        f"&redirect_uri={REDIRECT_URI}"
        f"&state={encoded_state}"
    )
    
    return auth_url

async def oauth2callback_hubspot(request: Request):
    """Handle OAuth callback from HubSpot"""
    if request.query_params.get('error'):
        raise HTTPException(status_code=400, detail=request.query_params.get('error_description'))
    
    code = request.query_params.get('code')
    encoded_state = request.query_params.get('state')
    state_data = json.loads(base64.urlsafe_b64decode(encoded_state).decode('utf-8'))
    
    original_state = state_data.get('state')
    user_id = state_data.get('user_id')
    org_id = state_data.get('org_id')
    
    saved_state = await get_value_redis(f'hubspot_state:{org_id}:{user_id}')
    
    if not saved_state or original_state != json.loads(saved_state).get('state'):
        raise HTTPException(status_code=400, detail='Invalid state parameter')

    async with httpx.AsyncClient() as client:
        response = await client.post(
            'https://api.hubapi.com/oauth/v1/token',
            data={
                'grant_type': 'authorization_code',
                'client_id': CLIENT_ID,
                'client_secret': CLIENT_SECRET,
                'redirect_uri': REDIRECT_URI,
                'code': code
            }
        )
        
    await delete_key_redis(f'hubspot_state:{org_id}:{user_id}')
    await add_key_value_redis(
        f'hubspot_credentials:{org_id}:{user_id}',
        json.dumps(response.json()),
        expire=600
    )
    
    close_window_script = """
    <html>
        <script>
            window.close();
        </script>
    </html>
    """
    return HTMLResponse(content=close_window_script)

async def get_hubspot_credentials(user_id, org_id):
    """Retrieve stored HubSpot credentials"""
    credentials = await get_value_redis(f'hubspot_credentials:{org_id}:{user_id}')
    if not credentials:
        raise HTTPException(status_code=400, detail='No credentials found')
    
    credentials = json.loads(credentials)
    await delete_key_redis(f'hubspot_credentials:{org_id}:{user_id}')
    return credentials

async def get_items_hubspot(credentials):
    """Fetch HubSpot items using credentials"""
    credentials = json.loads(credentials) if isinstance(credentials, str) else credentials
    access_token = credentials.get('access_token')
    
    if not access_token:
        raise HTTPException(status_code=400, detail='Invalid credentials')

    headers = {
        'Authorization': f'Bearer {access_token}',
        'Content-Type': 'application/json'
    }
    
    async with httpx.AsyncClient() as client:
        # Fetch different HubSpot resources in parallel
        contacts_response, companies_response, deals_response = await asyncio.gather(
            client.get('https://api.hubapi.com/crm/v3/objects/contacts', headers=headers),
            client.get('https://api.hubapi.com/crm/v3/objects/companies', headers=headers),
            client.get('https://api.hubapi.com/crm/v3/objects/deals', headers=headers)
        )

    integration_items = []
    
    # Create parent CRM item
    crm_item = IntegrationItem(
        id="hubspot_crm",
        name="HubSpot CRM",
        type="CRM",
        parent_id=None,
        parent_path_or_name=None
    )
    integration_items.append(crm_item)
    
    # Process contacts
    if contacts_response.status_code == 200:
        contacts_data = contacts_response.json()
        contacts_item = IntegrationItem(
            id="hubspot_contacts",
            name="Contacts",
            type="ContactList",
            parent_id="hubspot_crm",
            parent_path_or_name="HubSpot CRM"
        )
        integration_items.append(contacts_item)
        
        for contact in contacts_data.get('results', []):
            integration_items.append(
                IntegrationItem(
                    id=f"contact_{contact['id']}",
                    name=f"{contact.get('properties', {}).get('firstname', '')} {contact.get('properties', {}).get('lastname', '')}",
                    type="Contact",
                    parent_id="hubspot_contacts",
                    parent_path_or_name="Contacts"
                )
            )
    
    # Process companies
    if companies_response.status_code == 200:
        companies_data = companies_response.json()
        companies_item = IntegrationItem(
            id="hubspot_companies",
            name="Companies",
            type="CompanyList",
            parent_id="hubspot_crm",
            parent_path_or_name="HubSpot CRM"
        )
        integration_items.append(companies_item)
        
        for company in companies_data.get('results', []):
            integration_items.append(
                IntegrationItem(
                    id=f"company_{company['id']}",
                    name=company.get('properties', {}).get('name', 'Unnamed Company'),
                    type="Company",
                    parent_id="hubspot_companies",
                    parent_path_or_name="Companies"
                )
            )
    
    # Process deals
    if deals_response.status_code == 200:
        deals_data = deals_response.json()
        deals_item = IntegrationItem(
            id="hubspot_deals",
            name="Deals",
            type="DealList",
            parent_id="hubspot_crm",
            parent_path_or_name="HubSpot CRM"
        )
        integration_items.append(deals_item)
        
        for deal in deals_data.get('results', []):
            integration_items.append(
                IntegrationItem(
                    id=f"deal_{deal['id']}",
                    name=deal.get('properties', {}).get('dealname', 'Unnamed Deal'),
                    type="Deal",
                    parent_id="hubspot_deals",
                    parent_path_or_name="Deals"
                )
            )
    
    return integration_items