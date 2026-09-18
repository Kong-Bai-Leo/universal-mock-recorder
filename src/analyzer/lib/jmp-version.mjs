// Version identity is recording evidence, not a guess from an installed map.
const known = value => typeof value === 'string' && value.trim() && value.trim().toLowerCase() !== 'unknown';
function one(label, values) {
  const present = values.filter(known).map(value => value.trim());
  if (new Set(present.map(value => value.toLowerCase())).size > 1) throw Error(`JMP ${label} conflicts between manifest, config and CLI`);
  return present[0] ?? null;
}
export function resolveJmpVersion(manifest, config = {}, options = {}) {
  const version = one('version', [manifest.applicationVersion, config.version, options.jmpVersion]);
  const edition = one('edition', [manifest.applicationEdition, config.edition, options.jmpEdition]);
  const language = one('language', [manifest.language, config.language, options.jmpLanguage]);
  if (!version) throw Error('JMP version unknown; set manifest.applicationVersion, config.jmp.version or --jmp-version after checking About');
  if (!edition) throw Error('JMP edition unknown; set manifest.applicationEdition, config.jmp.edition or --jmp-edition after checking About');
  if (!language) throw Error('JMP language unknown; set manifest.language, config.jmp.language or --jmp-language after checking UI');
  // The 18 map was observed on 18.0.0, not on 18.1/18.2.
  const match = /^(18\.0(?:\.\d+){0,2}|19\.1(?:\.\d+){0,2})$/.exec(version);
  if (!match) throw Error(`Unsupported JMP version ${version}; no matching UI map/API contract`);
  if (!['Pro', 'Trial', 'Standard'].includes(edition)) throw Error(`Unsupported JMP edition ${edition}`);
  if (language !== 'en-US') throw Error(`Unsupported JMP language ${language}; no matching UI map`);
  const mapVersion = version.startsWith('18') ? '18' : '19.1';
  if((mapVersion==='18'&&edition!=='Pro')||(mapVersion==='19.1'&&edition!=='Trial'))
    throw Error(`JMP ${version} ${edition} has no edition-matched observed UI map`);
  const apiCatalogVersion = `jmp-jsl-${mapVersion}-v1`;
  return {name:'JMP',version,edition,language,mapVersion,apiCatalogVersion,displayName:`JMP ${edition} ${version}`};
}
