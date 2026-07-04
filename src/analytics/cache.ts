import { LRUCache } from 'lru-cache'
import type { TradeBatch } from '../models.js'

const cache = new LRUCache<string, any>({ max: 500, ttl: 1000 * 30 })

export function createBatchKey(batches: TradeBatch[]) {
  const summary = batches.map((batch) => ({ id: batch.id, orders: batch.orders.length }))
  const cacheKey = JSON.stringify(summary)
  cache.set(cacheKey, summary)
  return { summary, cacheHit: cache.has(cacheKey) }
}

export function getCachedSummary(cacheKey: string) {
  return cache.get(cacheKey)
}
