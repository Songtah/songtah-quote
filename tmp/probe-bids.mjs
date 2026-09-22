const r = await fetch('https://pcc-api.openfun.app/api/searchbycompanyname?query=' + encodeURIComponent('崧達'))
const j = await r.json()
console.log('keys', Object.keys(j), 'total', j.total_records, 'pages', j.total_pages, 'n', (j.records||[]).length)
console.log((j.records||[]).slice(0,5).map(x=>`${x.date} ${x.unit_name}｜${x.brief?.title}｜${x.brief?.type}｜${JSON.stringify(x.brief?.companies?.names||[])}`))
