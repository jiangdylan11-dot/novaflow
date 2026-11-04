'use strict';

// CPU counters are cumulative per logical processor; compare two samples to
// report system-wide utilisation over the interval, not an invented instant.
function cpuSnapshot(cpus) {
  if (!Array.isArray(cpus) || !cpus.length) return null;
  let idle = 0, total = 0;
  for (const cpu of cpus) {
    const times = cpu?.times;
    if (!times || !['user', 'nice', 'sys', 'idle', 'irq'].every(key => Number.isFinite(times[key]) && times[key] >= 0)) return null;
    idle += times.idle;
    total += times.user + times.nice + times.sys + times.idle + times.irq;
  }
  return { idle, total, count: cpus.length };
}
function cpuPercent(previous, current) {
  if (!previous || !current || previous.count !== current.count) return null;
  const total = current.total - previous.total, idle = current.idle - previous.idle;
  if (total <= 0 || idle < 0 || idle > total) return null;
  return Math.max(0, Math.min(100, (total - idle) / total * 100));
}
function optionalNumber(value, max) {
  if (!/^\d+(?:\.\d+)?$/.test(String(value).trim())) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= max ? n : null;
}
function gpuRows(stdout) {
  return String(stdout || '').trim().split(/\r?\n/).map(line => {
    const match = line.match(/^(.*),\s*(\d+)\s*,\s*(\d+)\s*,\s*([^,]+),\s*([^,]+)\s*$/);
    if (!match) return null;
    const used = Number(match[2]) * 1048576, total = Number(match[3]) * 1048576;
    if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0 || used > total) return null;
    return {name: match[1].trim(), used, total, temperature: optionalNumber(match[4], 150), percent: optionalNumber(match[5], 100)};
  }).filter(Boolean);
}
// Windows thermal zones report tenths of a kelvin. A machine can expose several
// zones and some are idle placeholders, so the hottest valid one is the reading.
function thermalZoneCelsius(stdout) {
  const values = String(stdout || '').trim().split(/\r?\n/).map(line => optionalNumber(line, 4232)).filter(value => value > 2731.5).map(value => value / 10 - 273.15);
  return values.length ? Math.max(...values) : null;
}
module.exports = {cpuSnapshot, cpuPercent, gpuRows, thermalZoneCelsius};
