/* Coleta preços da região e notícias de mercado. Não grava nada: só devolve os dados.
   Fontes (páginas públicas, lidas 2 vezes por dia):
   - Agrolink, página regional de Guaíra (SP): preços das praças vizinhas
   - Notícias Agrícolas: indicadores CEPEA, milho na B3 e as manchetes de mercado de milho e soja
   - NovaCana (RSS): notícias de cana, etanol e açúcar */
'use strict';

const UA = 'Mozilla/5.0 (compatible; CadernoDaFazenda/1.0; uso pessoal)';
const AGROLINK = 'https://www.agrolink.com.br';
const NA = 'https://www.noticiasagricolas.com.br';

async function baixar(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR' }, signal: ctl.signal });
    if (!r.ok) throw new Error(`${url} respondeu ${r.status}`);
    return await r.text();
  } finally { clearTimeout(t); }
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const limpar = s => String(s || '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENT[e.toLowerCase()] ?? m))
  .replace(/\s+/g, ' ').trim();
const numBR = s => Number(String(s).replace(/\./g, '').replace(',', '.'));
const hojeBR = () => new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' });

/* ---------- Agrolink: praças perto de Guaíra ---------- */
async function precosRegiao() {
  const url = `${AGROLINK}/regional/sp/guaira`;
  const html = await baixar(url);
  const nomes = {};
  for (const m of html.matchAll(/href="\/regional\/sp\/([^"/]+)\/cotacoes"[^>]*>\s*<span[^>]*>([^<]+)</g)) nomes[m[1]] = limpar(m[2]);
  const re = /<a[^>]*href="\/cotacoes\/([^"/]+)\/sp\/([^"/]+)"[^>]*>\s*<span[^>]*>([^<]+)<\/span>\s*<span[^>]*>\s*<span[^>]*>R\$\s*([\d.,]+)<\/span>\s*<span[^>]*>([\d/]+)<\/span>/g;
  const vistos = new Set(), out = [];
  for (const m of html.matchAll(re)) {
    const [, prod, cidade, rotulo, preco, data] = m;
    const nome = limpar(rotulo);
    if (!/milho|soja|sorgo|feij/i.test(nome)) continue;
    const chave = prod + '|' + cidade; if (vistos.has(chave)) continue; vistos.add(chave);
    const u = nome.match(/\s+Sc\s+(\d+)\s*Kg$/i);
    out.push({
      fonteId: 'agrolink', produto: u ? nome.slice(0, u.index) : nome, unidade: u ? `sc ${u[1]} kg` : '',
      praca: (nomes[cidade] || cidade.replace(/-/g, ' ')) + (/\(SP\)/.test(nomes[cidade] || '') ? '' : ' (SP)'),
      valor: numBR(preco), data, fonte: 'Agrolink', url: `${AGROLINK}/cotacoes/${prod}/sp/${cidade}`
    });
  }
  if (!out.length) throw new Error('Agrolink: nenhum preço de milho ou soja encontrado (a página pode ter mudado)');
  return out.sort((a, b) => a.produto.localeCompare(b.produto) || a.praca.localeCompare(b.praca));
}

/* ---------- Notícias Agrícolas: CEPEA, B3 e manchetes ---------- */
function manchetes(html, tema) {
  const i = html.indexOf('Conteúdo relacionado'); if (i < 0) return [];
  const trecho = html.slice(i, i + 12000), out = [];
  for (const m of trecho.matchAll(/<li>\s*<span>([^<]+)<\/span>\s*<a href="(\/noticias\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const hora = limpar(m[1]);
    out.push({ fonteId: 'na-' + tema.toLowerCase(), titulo: limpar(m[3]), url: NA + m[2], fonte: 'Notícias Agrícolas', tema, data: /:/.test(hora) ? hojeBR() + ' ' + hora : hora });
  }
  return out;
}
async function noticiasAgricolas() {
  // milho traz os indicadores; soja só as manchetes. Uma página fora do ar não derruba a outra.
  const [rm, rs] = await Promise.allSettled([baixar(`${NA}/cotacoes/milho`), baixar(`${NA}/cotacoes/soja`)]);
  if (rm.status !== 'fulfilled') throw rm.reason;
  const milho = rm.value, soja = rs.status === 'fulfilled' ? rs.value : '';
  if (!soja) avisos.push(`Notícias Agrícolas (soja): ${rs.reason && rs.reason.message}`);
  const txt = limpar(milho.replace(/<\/(td|th|li|tr)>/g, ' | '));
  const precos = [];
  const cepea = [['Milho \\(sc\\. 60Kg\\)', 'Milho', 'Indicador CEPEA (Campinas-SP)', 'sc 60 kg'], ['Soja \\(PR/ sc\\. 60Kg\\)', 'Soja', 'Indicador CEPEA (Paranaguá-PR)', 'sc 60 kg'], ['Açúcar Cristal \\(sc\\. 50Kg\\)', 'Açúcar cristal', 'Indicador CEPEA (SP)', 'sc 50 kg']];
  const diaCepea = (txt.match(/Valores do dia:\s*(\d\d\/\d\d)/) || [])[1] || '';
  for (const [re, produto, praca, unidade] of cepea) {
    const m = txt.match(new RegExp(re + '\\s*\\|\\s*([\\d.,]+)\\s*\\|\\s*([-+]?[\\d,]+ ?%)'));
    if (m) precos.push({ fonteId: 'na-cepea', produto, praca, unidade, valor: numBR(m[1]), variacao: m[2].replace(/\s/g, ''), data: diaCepea, fonte: 'CEPEA via Notícias Agrícolas', url: `${NA}/cotacoes/milho` });
  }
  const b3 = txt.match(/Milho \((\w{3} \d\d)\)\s*\|\s*([\d.,]+)\s*\|\s*([-+]?[\d,]+ ?%)/);
  if (b3 && numBR(b3[2]) > 0) precos.push({ fonteId: 'na-b3', produto: 'Milho', praca: `B3, contrato ${b3[1].toLowerCase()}`, unidade: 'sc 60 kg', valor: numBR(b3[2]), variacao: b3[3].replace(/\s/g, ''), data: hojeBR(), fonte: 'B3 via Notícias Agrícolas', url: `${NA}/cotacoes/milho` });
  if (!precos.length) throw new Error('Notícias Agrícolas: indicadores não encontrados (a página pode ter mudado)');
  return { precos, noticias: [...manchetes(milho, 'Milho'), ...manchetes(soja, 'Soja')] };
}

/* ---------- RSS: NovaCana (cana, etanol, açúcar) e Canal Rural (milho, soja) ---------- */
async function rss(url, fonteId, fonte, tema) {
  const xml = await baixar(url);
  const out = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const it = m[1], tag = t => limpar((it.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)) || [])[1]);
    const d = new Date(tag('pubDate'));
    if (!isNaN(d) && Date.now() - d > 4 * 86400000) continue;   // só dos últimos 4 dias
    out.push({ fonteId, titulo: tag('title'), url: tag('link'), resumo: tag('description').slice(0, 220), fonte, tema,
      data: isNaN(d) ? '' : d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' }) });
  }
  if (!out.length) throw new Error(`${fonte} (${tema}): nada recente no RSS`);
  return out;
}
const novaCana = () => rss('https://www.novacana.com/rss', 'novacana', 'NovaCana', 'Cana');
const canalMilho = () => rss('https://www.canalrural.com.br/agricultura/milho/feed/', 'cr-milho', 'Canal Rural', 'Milho');
const canalSoja = () => rss('https://www.canalrural.com.br/agricultura/soja/feed/', 'cr-soja', 'Canal Rural', 'Soja');

/* ---------- o que importa ---------- */
// fica: preço, safra, clima, oferta e demanda, câmbio, custos, cana/ATR; sai: eventos, concursos, crimes, política sem efeito no mercado
const IMPORTA = /pre[çc]o|cota[çc]|b3|chicago|cbot|d[óo]lar|safra|safrinha|colheita|plantio|estimativa|conab|usda|estoque|exporta|importa|demanda|oferta|clima|chuva|seca|geada|frete|fertiliz|ureia|custo|atr|consecana|moagem|etanol|a[çc][úu]car|mix|unica|cepea|mercado|pre[çc]os/i;
const DESCARTA = /concurso|pr[êe]mio|evento|feira|live|podcast|webinar|resgat|escrav|pol[íi]cia|crime|acidente|morre|homenag|anivers/i;
function relevantes(lista, max) {
  const vistos = new Set(), out = [];
  for (const n of lista) {
    if (!n.titulo || !/^https:\/\//.test(n.url)) continue;
    const texto = n.titulo + ' ' + (n.resumo || '');
    if (DESCARTA.test(texto) || !IMPORTA.test(texto)) continue;
    const k = n.titulo.toLowerCase().slice(0, 60); if (vistos.has(k)) continue; vistos.add(k);
    out.push(n); if (out.length >= max) break;
  }
  return out;
}

const avisos = [];
async function coletar() {
  avisos.length = 0;
  const erros = avisos;
  const pega = async (nome, f) => { try { return await f(); } catch (e) { erros.push(`${nome}: ${e.message}`); return null; } };
  const [reg, na, nc, crm, crs] = await Promise.all([pega('Agrolink', precosRegiao), pega('Notícias Agrícolas', noticiasAgricolas), pega('NovaCana', novaCana),
    pega('Canal Rural milho', canalMilho), pega('Canal Rural soja', canalSoja)]);
  const agora = new Date().toISOString();
  const precos = [...(reg || []), ...((na && na.precos) || [])].map(p => ({ ...p, coletadoEm: agora }));
  const naN = (na && na.noticias) || [];
  const milho = relevantes([...naN.filter(n => n.tema === 'Milho'), ...(crm || [])], 4);
  const soja = relevantes([...naN.filter(n => n.tema === 'Soja'), ...(crs || [])], 3);
  const noticias = [...milho, ...soja, ...relevantes(nc || [], 4)].map(n => ({ ...n, coletadoEm: agora }));
  // manchetes: se uma fonte falhar, a outra do mesmo tema cobre; só guarda as antigas se o tema ficar vazio
  const falhou = { agrolink: !reg, 'na-cepea': !na, 'na-b3': !na, 'na-milho': !milho.length, 'cr-milho': !milho.length, 'na-soja': !soja.length, 'cr-soja': !soja.length, novacana: !nc };
  return { precos, noticias, erros, falhou };
}

module.exports = { coletar };
