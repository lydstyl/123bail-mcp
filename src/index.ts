#!/usr/bin/env node
/**
 * mcp-123bail — MCP server for 123bail / Dokimo rental management.
 *
 * Talks to a Dokimo instance over REST using an API key (x-api-key header).
 * Transport: stdio (plug into Claude Desktop, Cursor, Hermes, etc.)
 *
 * Env:
 *   DOKIMO_URL     — base URL of your Dokimo/123bail instance (e.g. https://logisange.duckdns.org:8092)
 *   DOKIMO_API_KEY — an API key created in the app (Settings → API keys), format mcp_...
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const BASE_URL = (process.env.DOKIMO_URL ?? '').replace(/\/+$/, '')
const API_KEY = process.env.DOKIMO_API_KEY ?? ''

if (!BASE_URL || !API_KEY) {
  console.error('mcp-123bail: DOKIMO_URL and DOKIMO_API_KEY environment variables are required.')
  process.exit(1)
}

// ── REST helpers ─────────────────────────────────────────────────────────────

async function api<T = any>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE_URL + path, {
    ...init,
    headers: {
      'x-api-key': API_KEY,
      'Content-Type': 'application/json',
      ...(init?.headers as Record<string, string> | undefined),
    },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Dokimo API ${res.status} on ${path}: ${text.slice(0, 300)}`)
  }
  return res.json() as Promise<T>
}

async function apiPdf(path: string): Promise<Buffer> {
  const res = await fetch(BASE_URL + path, { headers: { 'x-api-key': API_KEY } })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Dokimo API ${res.status} on ${path}: ${text.slice(0, 300)}`)
  }
  return Buffer.from(await res.arrayBuffer())
}

function json(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
}

// ── Server ───────────────────────────────────────────────────────────────────

const server = new McpServer({ name: 'mcp-123bail', version: '1.0.0' })

// ── 1. list_landlords ────────────────────────────────────────────────────────
server.tool(
  'list_landlords',
  'List all landlords with contact information',
  {},
  async () => json(await api('/api/landlords'))
)

// ── 2. get_properties_by_landlord ────────────────────────────────────────────
server.tool(
  'get_properties_by_landlord',
  'List all properties (rental units) of a landlord, with lease counts',
  { landlord: z.string().describe('Landlord name or ID') },
  async ({ landlord }) => {
    const landlords = await api<any[]>('/api/landlords')
    const l = landlords.find(
      (x) => x.id === landlord || x.name?.toLowerCase().includes(landlord.toLowerCase())
    )
    if (!l) throw new Error(`Landlord not found: ${landlord}`)
    const properties = await api<any[]>('/api/properties')
    return json(properties.filter((p) => p.landlordId === l.id))
  }
)

// ── 3. get_tenants_by_landlord ───────────────────────────────────────────────
server.tool(
  'get_tenants_by_landlord',
  'List all tenants (email, phone) linked to a landlord via their properties and leases',
  { landlord: z.string().describe('Landlord name or ID') },
  async ({ landlord }) => {
    const landlords = await api<any[]>('/api/landlords')
    const l = landlords.find(
      (x) => x.id === landlord || x.name?.toLowerCase().includes(landlord.toLowerCase())
    )
    if (!l) throw new Error(`Landlord not found: ${landlord}`)
    const properties = await api<any[]>('/api/properties')
    const propIds = new Set(properties.filter((p) => p.landlordId === l.id).map((p) => p.id))
    const leases = await api<any[]>('/api/leases')
    const tenantIds = new Set<string>()
    for (const lease of leases) {
      if (propIds.has(lease.propertyId)) {
        for (const t of lease.tenantIds ?? []) tenantIds.add(t)
      }
    }
    const tenants = await api<any[]>('/api/tenants')
    return json(tenants.filter((t) => tenantIds.has(t.id)))
  }
)

// ── 4. search_tenants ────────────────────────────────────────────────────────
server.tool(
  'search_tenants',
  'Search tenants by name, first name, or email',
  { query: z.string().describe('Search string (name, firstName, email)') },
  async ({ query }) => {
    const q = query.toLowerCase()
    const tenants = await api<any[]>('/api/tenants')
    return json(
      tenants.filter(
        (t) =>
          t.firstName?.toLowerCase().includes(q) ||
          t.lastName?.toLowerCase().includes(q) ||
          t.email?.toLowerCase().includes(q)
      )
    )
  }
)

// ── 5. find_leases_by_tenant ─────────────────────────────────────────────────
server.tool(
  'find_leases_by_tenant',
  'Find all leases of a tenant by tenant ID, name, or email',
  { tenant: z.string().describe('Tenant ID, full name, or email') },
  async ({ tenant }) => {
    let byId = await api<any[]>('/api/leases?tenantId=' + encodeURIComponent(tenant)).catch(() => [])
    if (byId.length === 0) {
      const t = (await api<any[]>('/api/tenants')).find(
        (x) => x.id === tenant || `${x.firstName} ${x.lastName}`.toLowerCase() === tenant.toLowerCase() || x.email?.toLowerCase() === tenant.toLowerCase()
      )
      if (!t) throw new Error(`Tenant not found: ${tenant}`)
      byId = await api<any[]>('/api/leases?tenantId=' + encodeURIComponent(t.id)).catch(() => [])
    }
    return json(byId)
  }
)

// ── 6. get_active_leases ─────────────────────────────────────────────────────
server.tool(
  'get_active_leases',
  'List all currently active leases (with tenant and property details)',
  {},
  async () => json(await api('/api/leases?activeOnly=true'))
)

// ── 7. add_payment ───────────────────────────────────────────────────────────
server.tool(
  'add_payment',
  'Record a rent payment for a lease',
  {
    lease_id: z.string().describe('Lease ID'),
    amount: z.number().describe('Amount in EUR (decimal)'),
    payment_date: z.string().describe('Payment date YYYY-MM-DD'),
    notes: z.string().optional().describe('Optional notes'),
  },
  async ({ lease_id, amount, payment_date, notes }) =>
    json(await api('/api/payments', { method: 'POST', body: JSON.stringify({ leaseId: lease_id, amount, paymentDate: payment_date, notes }) }))
)

// ── 8. get_payment_summary_by_landlord ───────────────────────────────────────
server.tool(
  'get_payment_summary_by_landlord',
  'Payment summary over the last N months for the active leases of a landlord (per-lease monthly due/paid/balance)',
  {
    landlord: z.string().describe('Landlord name or ID'),
    months: z.number().int().min(1).max(36).default(3).describe('Number of months to summarize (default 3)'),
  },
  async ({ landlord, months = 3 }) => {
    const landlords = await api<any[]>('/api/landlords')
    const l = landlords.find(
      (x) => x.id === landlord || x.name?.toLowerCase().includes(landlord.toLowerCase())
    )
    if (!l) throw new Error(`Landlord not found: ${landlord}`)
    const properties = await api<any[]>('/api/properties')
    const propIds = new Set(properties.filter((p) => p.landlordId === l.id).map((p) => p.id))
    const leases = (await api<any[]>('/api/leases?activeOnly=true')).filter((le) => propIds.has(le.propertyId))

    const now = new Date()
    const monthsList: string[] = []
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      monthsList.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    }

    const out: any[] = []
    for (const lease of leases) {
      const history = await api<any>(`/api/leases/${lease.id}/monthly-payment-history?months=${months}`).catch(() => null)
      out.push({
        leaseId: lease.id,
        property: lease.property?.name,
        tenants: (lease.tenants ?? []).map((t: any) => `${t.firstName} ${t.lastName}`.trim()),
        rentAmount: lease.rentAmount,
        paymentHistory: history,
      })
    }
    return json({ landlord: l.name, months: monthsList, leases: out })
  }
)

// ── 9. create_lease ──────────────────────────────────────────────────────────
server.tool(
  'create_lease',
  'Create a new lease (bail) for a property and one or more tenants',
  {
    propertyId: z.string().describe('Property ID'),
    tenantIds: z.array(z.string()).min(1).describe('Tenant IDs (see search_tenants)'),
    startDate: z.string().describe('Start date YYYY-MM-DD'),
    endDate: z.string().optional().describe('End date YYYY-MM-DD (optional)'),
    rentAmount: z.number().describe('Monthly rent in EUR (excluding charges)'),
    chargesAmount: z.number().describe('Monthly charges in EUR (0 if none)'),
    paymentDueDay: z.number().int().min(1).max(28).describe('Payment due day of month (1-28)'),
    irlQuarter: z.string().optional().describe('IRL quarter reference for rent indexation'),
    note: z.string().optional().describe('Optional note'),
  },
  async (p) => json(await api('/api/leases', { method: 'POST', body: JSON.stringify(p) }))
)

// ── 10. generate_receipt ─────────────────────────────────────────────────────
server.tool(
  'generate_receipt',
  'Generate the rent receipt PDF (quittance de loyer) for a lease and a month. Returns the PDF as base64.',
  {
    leaseId: z.string().describe('Lease ID'),
    month: z.string().describe('Month YYYY-MM (e.g. 2026-10)'),
  },
  async ({ leaseId, month }) => {
    const pdf = await apiPdf(`/api/leases/${leaseId}/receipts-pdf?month=${month}`)
    return {
      content: [
        {
          type: 'text' as const,
          text: `Receipt PDF for lease ${leaseId} (${month}), ${pdf.length} bytes. Base64:\n` + pdf.toString('base64'),
        },
      ],
    }
  }
)

// ── Transport ────────────────────────────────────────────────────────────────
async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('mcp-123bail running (stdio) → ' + BASE_URL)
}

main().catch((err) => {
  console.error('mcp-123bail fatal:', err)
  process.exit(1)
})
