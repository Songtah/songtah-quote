const { fetchOfficialPeriod } = await import('../lib/tender-official.ts')
for (const p of ['20260702','20260701']) {
  const recs = await fetchOfficialPeriod(p)
  const t = recs.filter(r=>r.kind==='tender'), a = recs.filter(r=>r.kind==='award')
  console.log(p, '招標', t.length, '決標', a.length, '｜日期範圍', t[0]?.date, '~', t[t.length-1]?.date)
  const dent = recs.filter(r=>/牙|齒|口腔/.test(r.title+r.unitName))
  console.log('  含牙/齒/口腔：', dent.length, dent.slice(0,5).map(r=>`${r.date} ${r.unitName}｜${r.title}`))
}
