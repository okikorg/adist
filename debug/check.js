const { default: config } = require('../dist/config.js'); (async () => { try { const currentProjectId = await config.get('currentProject'); console.log('Current project:', currentProjectId); const indexes = await config.get("indexes."+currentProjectId); console.log('Indexes:', typeof indexes); const blockIndexes = await config.get("block-indexes."+currentProjectId); console.log('Block indexes:', typeof blockIndexes); } catch (err) { console.error('Error:', err); } })()
