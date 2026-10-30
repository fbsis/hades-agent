const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const SERVICES = [
  { action: 'translate', label: 'Traduzir com o Metis' },
  { action: 'proofread', label: 'Corrigir com o Metis' },
  { action: 'rewrite', label: 'Reescrever com o Metis' }
];
const xml = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const shellQuote = value => "'" + String(value).replace(/'/g, "'\\''") + "'";
function plist(value) {
  const encode = v => Array.isArray(v) ? `<array>${v.map(encode).join('')}</array>` : typeof v === 'object' && v ? `<dict>${Object.entries(v).map(([k, item]) => `<key>${xml(k)}</key>${encode(item)}`).join('')}</dict>` : typeof v === 'boolean' ? `<${v ? 'true' : 'false'}/>` : typeof v === 'number' ? `<integer>${v}</integer>` : `<string>${xml(v)}</string>`;
  return `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0">${encode(value)}</plist>`;
}
function workflow(service, helper, config) {
  return {
    info: plist({ CFBundleIdentifier: `com.fbsis.metis.text-service.${service.action}`, CFBundleName: service.label, CFBundleVersion: '1', MetisGeneratedService: true, NSServices: [{ NSMenuItem: { default: service.label }, NSMessage: 'runWorkflowAsService', NSTimeout: '120000', NSSendTypes: ['NSStringPboardType'], NSReturnTypes: ['NSStringPboardType'] }] }),
    document: plist({ AMApplicationBuild: '523', AMApplicationVersion: '2.10', AMDocumentVersion: '2', actions: [{ action: {
      AMAccepts: { Container: 'List', Types: ['com.apple.cocoa.string'] }, AMProvides: { Container: 'List', Types: ['com.apple.cocoa.string'] },
      AMActionVersion: '2.0.3', AMApplication: ['Automator'], ActionBundlePath: '/System/Library/Automator/Run Shell Script.action', ActionName: 'Run Shell Script', BundleIdentifier: 'com.apple.RunShellScript', CFBundleVersion: '2.0.3',
      ActionParameters: { shell: '/bin/sh', inputMethod: 0, source: `exec ${shellQuote(helper)} ${shellQuote(config)} ${shellQuote(service.action)}`, COMMAND_STRING: `exec ${shellQuote(helper)} ${shellQuote(config)} ${shellQuote(service.action)}`, CheckedForUserDefaultShell: true },
      InputUUID: crypto.randomUUID(), OutputUUID: crypto.randomUUID(), UUID: crypto.randomUUID(), isViewVisible: true
    }, isEnabled: true }], connectors: {}, workflowMetaData: { serviceInputTypeIdentifier: 'com.apple.Automator.text', serviceOutputTypeIdentifier: 'com.apple.Automator.text', serviceProcessesInput: 0, serviceReceives: 'text', workflowTypeIdentifier: 'com.apple.Automator.servicesMenu' } })
  };
}
function servicePath(directory, service) { return path.join(directory, `${service.label}.workflow`); }
function isManaged(directory) {
  try {
    if (fs.lstatSync(directory).isSymbolicLink()) return false;
    const info = fs.readFileSync(path.join(directory, 'Contents/Info.plist'), 'utf8');
    return info.includes('<key>MetisGeneratedService</key><true/>') && info.includes('com.fbsis.metis.text-service.');
  } catch { return false; }
}
function installWorkflows(directory, helper, config) {
  fs.mkdirSync(directory, { recursive: true });
  const outputs = [];
  for (const service of SERVICES) {
    const destination = servicePath(directory, service);
    if (fs.existsSync(destination) && !isManaged(destination)) throw new Error(`Já existe um serviço não gerenciado em ${service.label}. Nada foi sobrescrito.`);
    outputs.push({ service, destination });
  }
  for (const { service, destination } of outputs) {
    const generated = workflow(service, helper, config);
    const temporary = `${destination}.metis-${crypto.randomUUID()}`;
    fs.mkdirSync(path.join(temporary, 'Contents'), { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(temporary, 'Contents/Info.plist'), generated.info, { mode: 0o600 });
    fs.writeFileSync(path.join(temporary, 'Contents/document.wflow'), generated.document, { mode: 0o600 });
    const previous = `${destination}.metis-previous`;
    if (fs.existsSync(previous)) throw new Error('Existe uma instalação anterior incompleta; confira os serviços Metis antes de continuar.');
    if (fs.existsSync(destination)) fs.renameSync(destination, previous);
    try { fs.renameSync(temporary, destination); }
    catch (error) { if (fs.existsSync(previous)) fs.renameSync(previous, destination); throw error; }
    if (fs.existsSync(previous)) fs.rmSync(previous, { recursive: true });
  }
  return outputs.map(item => item.destination);
}
module.exports = { SERVICES, workflow, plist, shellQuote, installWorkflows, isManaged, servicePath };
