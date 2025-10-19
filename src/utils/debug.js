export function isDebug(key) {
  return String(process.env[key] || '').toLowerCase() === 'true';
}

export function dlog(key, ...args) {
  if (isDebug(key)) {
    const ts = new Date().toISOString();
    console.log(`[${ts}]`, ...args);
  }
}

