import { supabase } from './supabase.js'

/**
 * syncApprovedProposals — polls pricing_proposals with status='approved'
 * and pushes each price change to the configured active integration
 * (typically Microsoft Dynamics 365).
 *
 * The first active integration whose kind matches the product's target
 * receives the push. In a single-tenant setup that's usually just the
 * one Dynamics 365 integration.
 *
 * All calls are logged to integration_sync_log with request/response
 * payloads for auditability.
 */
export async function syncApprovedProposals() {
  const { data: proposals } = await supabase.from('pricing_proposals')
    .select('*, products(*)')
    .eq('status', 'approved')
    .limit(50)

  if (!proposals?.length) return

  const { data: integrations } = await supabase.from('integrations')
    .select('*').eq('is_active', true)

  for (const proposal of proposals) {
    // Pick the target — for now, prefer Dynamics 365.
    const target = integrations.find(i => i.kind === 'dynamics_365') || integrations[0]
    if (!target) {
      await supabase.from('pricing_proposals')
        .update({ status: 'skipped' })
        .eq('id', proposal.id)
      continue
    }

    const t0 = Date.now()
    const { data: logRow } = await supabase.from('integration_sync_log').insert({
      integration_id: target.id,
      operation: 'push_price',
      status: 'running',
      request_payload: {
        proposal_id: proposal.id,
        product_id: proposal.product_id,
        sku: proposal.products?.sku,
        new_price: proposal.suggested_price,
      },
    }).select().single()

    try {
      const response = await pushPrice(target, proposal)
      await supabase.from('integration_sync_log').update({
        status: 'ok',
        response_payload: response,
        duration_ms: Date.now() - t0,
      }).eq('id', logRow.id)
      await supabase.from('pricing_proposals').update({
        status: 'applied',
        applied_at: new Date().toISOString(),
        external_sync_id: logRow.id,
      }).eq('id', proposal.id)
      // Also bump products.current_price so it stays consistent
      await supabase.from('products')
        .update({ current_price: proposal.suggested_price })
        .eq('id', proposal.product_id)
    } catch (e) {
      await supabase.from('integration_sync_log').update({
        status: 'failed',
        error_message: e.message,
        duration_ms: Date.now() - t0,
      }).eq('id', logRow.id)
    }
  }
}

/**
 * Dispatch to per-integration push handler.
 */
async function pushPrice(integration, proposal) {
  switch (integration.kind) {
    case 'dynamics_365':     return pushDynamics365(integration, proposal)
    case 'shopify':          return pushShopify(integration, proposal)
    case 'woocommerce':      return pushWooCommerce(integration, proposal)
    case 'bigcommerce':      return pushBigCommerce(integration, proposal)
    case 'magento':          return pushMagento(integration, proposal)
    case 'google_analytics': throw new Error('GA is read-only; not a push target')
    default: throw new Error(`Unknown integration kind: ${integration.kind}`)
  }
}

// -----------------------------------------------------------------------------
// Dynamics 365
// -----------------------------------------------------------------------------
async function pushDynamics365(integration, proposal) {
  const { tenantId, clientId, clientSecret, resourceUrl } = integration.config || {}
  if (!tenantId || !clientId || !clientSecret || !resourceUrl) {
    throw new Error('Missing Dynamics 365 credentials (tenantId, clientId, clientSecret, resourceUrl)')
  }

  // 1. OAuth 2.0 client credentials grant — get an access token
  const tokenRes = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope: `${resourceUrl}/.default`,
    }),
  })
  if (!tokenRes.ok) throw new Error(`Dynamics token: ${tokenRes.status} ${await tokenRes.text()}`)
  const { access_token } = await tokenRes.json()

  // 2. PATCH the product price. Adjust entity name + attribute to match
  //    your Dynamics 365 setup — usually `products(<guid>)` with `price` field.
  //    You may need to look up the D365 product by our SKU first.
  const sku = proposal.products?.sku
  const query = await fetch(`${resourceUrl}/api/data/v9.2/products?$filter=productnumber eq '${encodeURIComponent(sku)}'&$select=productid`, {
    headers: { Authorization: `Bearer ${access_token}`, Accept: 'application/json' },
  })
  const { value = [] } = await query.json()
  if (!value.length) throw new Error(`Dynamics: product not found by SKU ${sku}`)
  const productId = value[0].productid

  const patch = await fetch(`${resourceUrl}/api/data/v9.2/products(${productId})`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${access_token}`,
      'Content-Type': 'application/json',
      'If-Match': '*',
    },
    body: JSON.stringify({ price: proposal.suggested_price }),
  })
  if (!patch.ok && patch.status !== 204) {
    throw new Error(`Dynamics PATCH failed: ${patch.status} ${await patch.text()}`)
  }
  return { productId, status: patch.status }
}

// -----------------------------------------------------------------------------
// Shopify — Admin API 2024-10, REST
// -----------------------------------------------------------------------------
async function pushShopify(integration, proposal) {
  const { shopDomain, accessToken } = integration.config || {}
  if (!shopDomain || !accessToken) throw new Error('Missing Shopify shopDomain / accessToken')

  const sku = proposal.products?.sku
  // Find variant by SKU
  const find = await fetch(`https://${shopDomain}/admin/api/2024-10/variants.json?sku=${encodeURIComponent(sku)}`, {
    headers: { 'X-Shopify-Access-Token': accessToken },
  })
  const { variants = [] } = await find.json()
  if (!variants.length) throw new Error(`Shopify: variant not found by SKU ${sku}`)
  const variant = variants[0]

  const upd = await fetch(`https://${shopDomain}/admin/api/2024-10/variants/${variant.id}.json`, {
    method: 'PUT',
    headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ variant: { id: variant.id, price: String(proposal.suggested_price) } }),
  })
  if (!upd.ok) throw new Error(`Shopify PUT: ${upd.status} ${await upd.text()}`)
  return { variantId: variant.id }
}

// -----------------------------------------------------------------------------
// WooCommerce — REST v3
// -----------------------------------------------------------------------------
async function pushWooCommerce(integration, proposal) {
  const { siteUrl, consumerKey, consumerSecret } = integration.config || {}
  if (!siteUrl || !consumerKey || !consumerSecret) throw new Error('Missing WooCommerce creds')

  const sku = proposal.products?.sku
  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64')
  const find = await fetch(`${siteUrl}/wp-json/wc/v3/products?sku=${encodeURIComponent(sku)}`, {
    headers: { Authorization: `Basic ${auth}` },
  })
  const arr = await find.json()
  if (!Array.isArray(arr) || !arr.length) throw new Error(`WooCommerce: SKU ${sku} not found`)
  const wcProd = arr[0]

  const upd = await fetch(`${siteUrl}/wp-json/wc/v3/products/${wcProd.id}`, {
    method: 'PUT',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ regular_price: String(proposal.suggested_price) }),
  })
  if (!upd.ok) throw new Error(`WooCommerce PUT: ${upd.status} ${await upd.text()}`)
  return { productId: wcProd.id }
}

// -----------------------------------------------------------------------------
// BigCommerce — v3 Catalog API
// -----------------------------------------------------------------------------
async function pushBigCommerce(integration, proposal) {
  const { storeHash, accessToken } = integration.config || {}
  if (!storeHash || !accessToken) throw new Error('Missing BigCommerce storeHash / accessToken')

  const sku = proposal.products?.sku
  const find = await fetch(`https://api.bigcommerce.com/stores/${storeHash}/v3/catalog/products?sku=${encodeURIComponent(sku)}`, {
    headers: { 'X-Auth-Token': accessToken, Accept: 'application/json' },
  })
  const { data = [] } = await find.json()
  if (!data.length) throw new Error(`BigCommerce: SKU ${sku} not found`)
  const bcProd = data[0]

  const upd = await fetch(`https://api.bigcommerce.com/stores/${storeHash}/v3/catalog/products/${bcProd.id}`, {
    method: 'PUT',
    headers: { 'X-Auth-Token': accessToken, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ price: Number(proposal.suggested_price) }),
  })
  if (!upd.ok) throw new Error(`BigCommerce PUT: ${upd.status} ${await upd.text()}`)
  return { productId: bcProd.id }
}

// -----------------------------------------------------------------------------
// Magento 2 — REST V1
// -----------------------------------------------------------------------------
async function pushMagento(integration, proposal) {
  const { baseUrl, accessToken } = integration.config || {}
  if (!baseUrl || !accessToken) throw new Error('Missing Magento baseUrl / accessToken')

  const sku = proposal.products?.sku
  const upd = await fetch(`${baseUrl}/products/${encodeURIComponent(sku)}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ product: { sku, price: Number(proposal.suggested_price) } }),
  })
  if (!upd.ok) throw new Error(`Magento PUT: ${upd.status} ${await upd.text()}`)
  return { sku }
}
