/* Roda no GitHub Actions: coleta preços e notícias e grava mercado.json na raiz do repositório.
   O app Caderno da Fazenda lê esse arquivo público (só tem preços e manchetes públicas). */
'use strict';
const fs = require('fs');
const path = require('path');
const { coletar } = require('./coletar');

const ARQ = path.join(__dirname, '..', 'mercado.json');

(async () => {
  let antigo = {};
  try { antigo = JSON.parse(fs.readFileSync(ARQ, 'utf8')); } catch (e) { antigo = {}; }
  const novo = await coletar();
  // fonte que falhou agora: mantém o que ela trouxe da última vez
  const manter = lista => (lista || []).filter(x => novo.falhou[x.fonteId]);
  const precos = [...novo.precos, ...manter(antigo.precos)];
  const noticias = [...novo.noticias, ...manter(antigo.noticias)];
  if (!precos.length && !noticias.length) { console.error('Nada coletado:', novo.erros); process.exit(1); }
  const saida = { atualizadoEm: new Date().toISOString(), precos, noticias, erros: novo.erros };
  fs.writeFileSync(ARQ, JSON.stringify(saida, null, 1) + '\n');
  console.log(`mercado: ${precos.length} preços, ${noticias.length} notícias, erros: ${novo.erros.join(' / ') || 'nenhum'}`);
})().catch(e => { console.error(e); process.exit(1); });
