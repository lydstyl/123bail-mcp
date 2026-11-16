# mcp-123bail

[Model Context Protocol](https://modelcontextprotocol.io) (MCP) server for **123bail / Dokimo** — self-hosted rental management (baux, locataires, loyers, quittances).

Give your AI agent (Claude Desktop, Cursor, Hermes, …) direct access to your rental portfolio: list tenants, find leases, record payments, create leases, and generate rent receipt PDFs (quittances de loyer).

## Features

| Tool | Description |
|---|---|
| `list_landlords` | All landlords with contact info |
| `get_properties_by_landlord` | Properties of a landlord |
| `get_tenants_by_landlord` | Tenants linked to a landlord |
| `search_tenants` | Search tenants by name / email |
| `find_leases_by_tenant` | Leases of a tenant |
| `get_active_leases` | All active leases |
| `add_payment` | Record a rent payment |
| `get_payment_summary_by_landlord` | Due / paid / balance over N months |
| `create_lease` | Create a new lease (bail) |
| `generate_receipt` | Rent receipt PDF (quittance) as base64 |

## Requirements

- Node.js ≥ 20
- A Dokimo / 123bail instance with **API keys** enabled (Settings → API keys → create a `mcp_…` key)

## Install

### Claude Desktop / any MCP client

```json
{
  "mcpServers": {
    "123bail": {
      "command": "npx",
      "args": ["github:lydstyl/123bail-mcp"],
      "env": {
        "DOKIMO_URL": "https://your-dokimo-instance.example.com",
        "DOKIMO_API_KEY": "mcp_xxx"
      }
    }
  }
}
```

### From source

```bash
git clone https://github.com/lydstyl/123bail-mcp.git
cd 123bail-mcp
npm install && npm run build
DOKIMO_URL=https://your-instance DOKIMO_API_KEY=mcp_xxx node dist/index.js
```

## Security

The server only sends your `DOKIMO_API_KEY` to the URL in `DOKIMO_URL`. Revoke a key anytime from the app — revocation is instant.

## License

MIT
