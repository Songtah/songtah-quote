const { fetchOurBids } = await import('../lib/tender-source.ts')
try {
  const s = await fetchOurBids('崧達')
  console.log('size', s.size, [...s].slice(0,3))
} catch (e) { console.log('ERR', e.message) }
