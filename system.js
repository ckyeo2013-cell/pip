'use strict';
/*
 * Pure helpers for Pip's "do things on my computer" abilities. Nothing here
 * touches the system by itself; actions.js decides when to use them, and only
 * after the user approves.
 */
const net = require('net');

// ------------------------------------------------------------------ Settings / Control Panel pages
// win: { url } opens a ms-settings: link, { cmd: [...] } starts a classic Control Panel applet / admin tool.
// mac: System Settings pane id (macOS 13+). linux: gnome-control-center panel name.
const PAGES = {
  main:               { label: 'Settings', win: { url: 'ms-settings:' }, mac: '', linux: '' },
  control_panel:      { label: 'Control Panel', win: { cmd: ['control'] } },
  wifi:               { label: 'Wi-Fi settings', win: { url: 'ms-settings:network-wifi' }, mac: 'com.apple.wifi-settings-extension', linux: 'wifi' },
  network:            { label: 'Network settings', win: { url: 'ms-settings:network' }, mac: 'com.apple.Network-Settings.extension', linux: 'network' },
  vpn:                { label: 'VPN settings', win: { url: 'ms-settings:network-vpn' }, mac: 'com.apple.Network-Settings.extension' },
  bluetooth:          { label: 'Bluetooth settings', win: { url: 'ms-settings:bluetooth' }, mac: 'com.apple.BluetoothSettings', linux: 'bluetooth' },
  display:            { label: 'Display settings', win: { url: 'ms-settings:display' }, mac: 'com.apple.Displays-Settings.extension', linux: 'display' },
  night_light:        { label: 'Night light / night shift', win: { url: 'ms-settings:nightlight' }, mac: 'com.apple.Displays-Settings.extension' },
  sound:              { label: 'Sound settings', win: { url: 'ms-settings:sound' }, mac: 'com.apple.Sound-Settings.extension', linux: 'sound' },
  power_battery:      { label: 'Power & battery settings', win: { url: 'ms-settings:powersleep' }, mac: 'com.apple.Battery-Settings.extension', linux: 'power' },
  notifications:      { label: 'Notification settings', win: { url: 'ms-settings:notifications' }, mac: 'com.apple.Notifications-Settings.extension', linux: 'notifications' },
  appearance:         { label: 'Appearance / personalization', win: { url: 'ms-settings:personalization' }, mac: 'com.apple.Appearance-Settings.extension', linux: 'background' },
  keyboard:           { label: 'Keyboard settings', win: { url: 'ms-settings:easeofaccess-keyboard' }, mac: 'com.apple.Keyboard-Settings.extension', linux: 'keyboard' },
  mouse:              { label: 'Mouse settings', win: { url: 'ms-settings:mousetouchpad' }, mac: 'com.apple.Mouse-Settings.extension', linux: 'mouse' },
  trackpad:           { label: 'Trackpad settings', win: { url: 'ms-settings:devices-touchpad' }, mac: 'com.apple.Trackpad-Settings.extension' },
  printers:           { label: 'Printers & scanners', win: { url: 'ms-settings:printers' }, mac: 'com.apple.Print-Scan-Settings.extension', linux: 'printers' },
  accessibility:      { label: 'Accessibility settings', win: { url: 'ms-settings:easeofaccess' }, mac: 'com.apple.Accessibility-Settings.extension', linux: 'universal-access' },
  privacy:            { label: 'Privacy & security settings', win: { url: 'ms-settings:privacy' }, mac: 'com.apple.settings.PrivacySecurity.extension', linux: 'privacy' },
  accounts:           { label: 'Accounts / users', win: { url: 'ms-settings:yourinfo' }, mac: 'com.apple.Users-Groups-Settings.extension', linux: 'user-accounts' },
  date_time:          { label: 'Date & time settings', win: { url: 'ms-settings:dateandtime' }, mac: 'com.apple.Date-Time-Settings.extension', linux: 'datetime' },
  language_region:    { label: 'Language & region settings', win: { url: 'ms-settings:regionlanguage' }, mac: 'com.apple.Localization-Settings.extension', linux: 'region' },
  software_update:    { label: 'Software / system update', win: { url: 'ms-settings:windowsupdate' }, mac: 'com.apple.Software-Update-Settings.extension' },
  storage:            { label: 'Storage settings', win: { url: 'ms-settings:storagesense' }, mac: 'com.apple.settings.Storage' },
  apps:               { label: 'Installed apps / uninstall', win: { url: 'ms-settings:appsfeatures' }, mac: 'com.apple.Login-Items-Settings.extension' },
  default_apps:       { label: 'Default apps', win: { url: 'ms-settings:defaultapps' }, linux: 'default-apps' },
  startup_apps:       { label: 'Startup apps', win: { url: 'ms-settings:startupapps' }, mac: 'com.apple.Login-Items-Settings.extension' },
  about:              { label: 'About this computer', win: { url: 'ms-settings:about' }, mac: 'com.apple.SystemProfiler.AboutExtension', linux: 'info-overview' },
  // classic Windows Control Panel applets and admin tools
  programs_features:  { label: 'Control Panel: Programs and Features', win: { cmd: ['appwiz.cpl'] } },
  network_connections:{ label: 'Control Panel: Network Connections', win: { cmd: ['ncpa.cpl'] } },
  sound_classic:      { label: 'Control Panel: Sound (classic)', win: { cmd: ['mmsys.cpl'] } },
  power_options:      { label: 'Control Panel: Power Options', win: { cmd: ['powercfg.cpl'] } },
  system_properties:  { label: 'System Properties', win: { cmd: ['sysdm.cpl'] } },
  mouse_classic:      { label: 'Control Panel: Mouse (classic)', win: { cmd: ['main.cpl'] } },
  date_time_classic:  { label: 'Control Panel: Date and Time (classic)', win: { cmd: ['timedate.cpl'] } },
  firewall:           { label: 'Windows Defender Firewall', win: { cmd: ['firewall.cpl'] } },
  internet_options:   { label: 'Internet Options', win: { cmd: ['inetcpl.cpl'] } },
  region_classic:     { label: 'Control Panel: Region (classic)', win: { cmd: ['intl.cpl'] } },
  fonts:              { label: 'Fonts', win: { cmd: ['control', 'fonts'] } },
  user_accounts:      { label: 'User Accounts (netplwiz)', win: { cmd: ['netplwiz'] } },
  device_manager:     { label: 'Device Manager', win: { cmd: ['devmgmt.msc'] } },
  disk_management:    { label: 'Disk Management', win: { cmd: ['diskmgmt.msc'] } },
  services:           { label: 'Services', win: { cmd: ['services.msc'] } },
  event_viewer:       { label: 'Event Viewer', win: { cmd: ['eventvwr.msc'] } },
  task_manager:       { label: 'Task Manager / Activity Monitor', win: { cmd: ['taskmgr'] }, macApp: 'Activity Monitor', linuxCmd: ['gnome-system-monitor'] },
};

function pageNames(platform) {
  return Object.keys(PAGES).filter((k) => {
    const p = PAGES[k];
    if (platform === 'win32') return !!p.win;
    if (platform === 'darwin') return k === 'main' || k === 'control_panel' || p.mac !== undefined || !!p.macApp;
    return k === 'main' || k === 'control_panel' || p.linux !== undefined || !!p.linuxCmd;
  });
}

// Returns { label, exact, steps: [{type:'url',url} | {type:'exec',cmd,args}] }; tried in order.
function settingsLaunch(page, platform) {
  const key = String(page || 'main').toLowerCase().trim().replace(/[\s-]+/g, '_');
  const p = Object.prototype.hasOwnProperty.call(PAGES, key) ? PAGES[key] : null;
  if (!p) throw new Error(`Unknown settings page "${page}". Available: ${pageNames(platform).join(', ')}.`);

  if (platform === 'win32') {
    if (!p.win) throw new Error(`"${key}" is not available on Windows.`);
    if (p.win.url) return { label: p.label, exact: true, steps: [{ type: 'url', url: p.win.url }] };
    return { label: p.label, exact: true, steps: [{ type: 'exec', cmd: 'cmd.exe', args: ['/c', 'start', '', ...p.win.cmd] }] };
  }

  if (platform === 'darwin') {
    if (p.macApp) return { label: p.macApp, exact: true, steps: [{ type: 'exec', cmd: 'open', args: ['-a', p.macApp] }] };
    const mainApps = [
      { type: 'exec', cmd: 'open', args: ['-a', 'System Settings'] },
      { type: 'exec', cmd: 'open', args: ['-a', 'System Preferences'] },
    ];
    if (key === 'main' || key === 'control_panel') {
      return { label: 'System Settings', exact: key === 'main', steps: mainApps };
    }
    if (p.mac) {
      return { label: p.label, exact: true, steps: [{ type: 'url', url: `x-apple.systempreferences:${p.mac}` }, ...mainApps] };
    }
    return { label: 'System Settings', exact: false, steps: mainApps };
  }

  // Linux
  if (p.linuxCmd) return { label: p.label, exact: true, steps: [{ type: 'exec', cmd: p.linuxCmd[0], args: p.linuxCmd.slice(1) }] };
  const steps = [];
  if (p.linux) steps.push({ type: 'exec', cmd: 'gnome-control-center', args: [p.linux] });
  steps.push({ type: 'exec', cmd: 'gnome-control-center', args: [] });
  steps.push({ type: 'exec', cmd: 'systemsettings', args: [] });
  steps.push({ type: 'exec', cmd: 'systemsettings5', args: [] });
  return { label: p.linux ? p.label : 'System Settings', exact: !!p.linux || key === 'main', steps };
}

// ------------------------------------------------------------------ shell commands
function psArgs(script) {
  const prefix = '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $ProgressPreference="SilentlyContinue"; ';
  return ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(prefix + script, 'utf16le').toString('base64')];
}

function buildShell(command, platform) {
  if (platform === 'win32') return { cmd: 'powershell.exe', args: psArgs(command) };
  return { cmd: platform === 'darwin' ? '/bin/zsh' : '/bin/sh', args: ['-c', command] };
}

const shellName = (platform) => (platform === 'win32' ? 'PowerShell' : platform === 'darwin' ? 'zsh' : 'sh');

// Hard stops: things Pip will not do even if approved. (The approval card is the real safety gate;
// this list only catches the most destructive or secret-stealing mistakes.)
const BLOCKS = [
  [/(^|[;&|(`\s])(sudo|doas|pkexec|runas)(\s|$)/i, 'Pip never uses sudo, admin elevation or passwords. If this needs admin rights, do it yourself.'],
  [/(^|[;&|]\s*)su\s+-?\w*(\s|$)/i, 'Pip never switches users or handles passwords.'],
  [/\brm\s+(-\S+\s+)*(\/\*|\/|~\/?\*?|\$HOME\/?\*?|\*)(\s|$)/i, 'That command would wipe a huge amount of data.'],
  [/\b(mkfs(\.\w+)?|diskpart|Format-Volume|Clear-Disk|Initialize-Disk|fdisk|wipefs|shred)\b/i, 'Pip will not format, partition or wipe disks.'],
  [/\bformat\s+[a-z]:/i, 'Pip will not format drives.'],
  [/\bdd\s+[^|;&]*\bof=\/dev\//i, 'Pip will not write raw data to devices.'],
  [/:\s*\(\s*\)\s*\{/, 'That looks like a fork bomb.'],
  [/\b(del|erase|rd|rmdir|Remove-Item|ri)\b[^|;&\n]*?(?:^|\s|['"])([a-z]:\\?\*?|\$env:(SystemRoot|windir|USERPROFILE|HOMEDRIVE)\\?\*?|~[\\/]?\*?|\$HOME\\?\*?)(?=['"]?(\s|$))/i, 'That would delete an entire drive or profile.'],
  [/\breg(\.exe)?\s+delete\s+hk(lm|cr|u)\\?(\s|$)/i, 'Pip will not delete whole registry hives.'],
  [/\b(bcdedit|cipher\s+\/w|vssadmin\s+delete|wbadmin\s+delete|csrutil|nvram\s+-c)\b/i, 'That touches boot or backup safety systems, so Pip will not run it.'],
  [/(Set-MpPreference|Add-MpPreference|DisableRealtimeMonitoring|netsh\s+advfirewall\s+set\s+\w+\s+state\s+off|spctl\s+--master-disable|setenforce\s+0|ufw\s+disable|Set-ExecutionPolicy\s+(Unrestricted|Bypass))/i, 'Pip will not turn off security protection. You can do that yourself in settings if you really want to.'],
  [/\b(curl|wget|iwr|irm|Invoke-WebRequest|Invoke-RestMethod)\b[^\n]*\|\s*(sudo\s+)?(sh|bash|zsh|iex|Invoke-Expression|powershell|pwsh|python3?)\b/i, 'Pip will not download and run code in one step.'],
  [/\b(DownloadString|DownloadFile)\b[^\n]*\b(iex|Invoke-Expression)\b|\b(iex|Invoke-Expression)\b[^\n]*\b(DownloadString|iwr|irm)\b/i, 'Pip will not download and run code in one step.'],
  [/(cmdkey|vaultcmd|security\s+(find|dump|export)-?\w*|secret-tool|Get-StoredCredential|mimikatz|lsass|\bSAM\b\s+(save|hive))/i, 'Pip stays away from stored passwords and credentials.'],
  [/(\.ssh[\\/]|\.gnupg|\.aws[\\/]|\.kube[\\/]|id_rsa|id_ed25519|Library[\\/]Keychains|Login Data|\.netrc|gcloud[\\/]credentials|Credentials[\\/]|\\Microsoft\\Protect)/i, 'Pip stays out of places that hold passwords, keys and tokens.'],
];

const FLAGS = [
  [/\b(rm|del|erase|rmdir|rd|Remove-Item|unlink)\b/i, 'it can delete files (deleted this way does NOT go to the Trash)'],
  [/\b(reg(\.exe)?\s+(add|delete|import)|Set-ItemProperty|New-ItemProperty|Remove-ItemProperty|defaults\s+(write|delete)|gsettings\s+set)\b/i, 'it changes system or app settings'],
  [/\b(shutdown|reboot|restart-computer|stop-computer|poweroff|halt|logoff)\b/i, 'it can shut down, restart or log you out'],
  [/\b(kill|killall|pkill|taskkill|Stop-Process)\b/i, 'it can force-close programs (unsaved work may be lost)'],
  [/\b(chmod|chown|icacls|takeown|attrib)\b/i, 'it changes file permissions'],
  [/\b(curl|wget|iwr|irm|Invoke-WebRequest|Invoke-RestMethod|scp|sftp|ftp|nc|ncat|ssh|rsync)\b/i, 'it uses the network'],
  [/\b(winget|choco|scoop|brew|apt(-get)?|dnf|yum|pacman|snap|npm|pip3?|pipx|gem|cargo)\s+(install|uninstall|remove|upgrade|i)\b/i, 'it installs or removes software'],
  [/\b(Set-Content|Out-File|Add-Content|tee|mv|move|Move-Item|cp|copy|Copy-Item|ren|rename|Rename-Item|mkdir|New-Item|touch)\b|[^>]>\s*[^\s&]|>>/i, 'it creates, moves or changes files'],
];

function checkCommand(command, extraSecretStrings = []) {
  if (typeof command !== 'string' || !command.trim()) return { blocked: 'There is no command to run.', flags: [] };
  if (command.length > 4000) return { blocked: 'That command is too long (max 4000 characters).', flags: [] };
  for (const [re, why] of BLOCKS) if (re.test(command)) return { blocked: why, flags: [] };
  const low = command.toLowerCase();
  for (const s of extraSecretStrings) {
    if (s && low.includes(String(s).toLowerCase())) return { blocked: "That touches Pip's own private settings, which Pip keeps off limits.", flags: [] };
  }
  return { blocked: '', flags: FLAGS.filter(([re]) => re.test(command)).map(([, t]) => t) };
}

// ------------------------------------------------------------------ key presses
const NAMED = {
  enter: { win: '{ENTER}', mac: 36, x: 'Return' },
  return: { win: '{ENTER}', mac: 36, x: 'Return' },
  tab: { win: '{TAB}', mac: 48, x: 'Tab' },
  escape: { win: '{ESC}', mac: 53, x: 'Escape' },
  esc: { win: '{ESC}', mac: 53, x: 'Escape' },
  space: { win: ' ', mac: 49, x: 'space' },
  backspace: { win: '{BACKSPACE}', mac: 51, x: 'BackSpace' },
  delete: { win: '{DELETE}', mac: 117, x: 'Delete' },
  up: { win: '{UP}', mac: 126, x: 'Up' },
  down: { win: '{DOWN}', mac: 125, x: 'Down' },
  left: { win: '{LEFT}', mac: 123, x: 'Left' },
  right: { win: '{RIGHT}', mac: 124, x: 'Right' },
  home: { win: '{HOME}', mac: 115, x: 'Home' },
  end: { win: '{END}', mac: 119, x: 'End' },
  pageup: { win: '{PGUP}', mac: 116, x: 'Prior' },
  pagedown: { win: '{PGDN}', mac: 121, x: 'Next' },
};
const FKEYS = { 1: 122, 2: 120, 3: 99, 4: 118, 5: 96, 6: 97, 7: 98, 8: 100, 9: 101, 10: 109, 11: 103, 12: 111 };

function parseCombo(str) {
  if (typeof str !== 'string') throw new Error('A key combination must be text, like "ctrl+s".');
  const parts = str.toLowerCase().split('+').map((s) => s.trim()).filter(Boolean);
  if (!parts.length) throw new Error('Empty key combination.');
  const mods = new Set();
  let key = '';
  for (const raw of parts) {
    const t = { control: 'ctrl', option: 'alt', command: 'cmd', meta: 'cmd', super: 'cmd', windows: 'cmd', win: 'cmd' }[raw] || raw;
    if (t === 'ctrl' || t === 'alt' || t === 'shift' || t === 'cmd') mods.add(t);
    else if (key) throw new Error(`"${str}" has more than one main key.`);
    else key = t;
  }
  if (!key) throw new Error(`"${str}" needs a main key, like "s" or "enter".`);
  const isF = /^f(\d{1,2})$/.test(key) && +key.slice(1) >= 1 && +key.slice(1) <= 12;
  if (!(NAMED[key] || isF || /^[a-z0-9]$/.test(key))) throw new Error(`Unsupported key "${key}". Use a letter, digit, F1-F12, enter, tab, escape, space, backspace, delete, arrows, home, end, pageup or pagedown.`);
  return { mods, key, isF, text: [...mods, key].join('+') };
}

function buildKeyCommand(combo, platform) {
  const { mods, key, isF } = combo;
  if (platform === 'win32') {
    if (mods.has('cmd')) throw new Error('The Windows key cannot be pressed by Pip. Try another way (an Open settings or run command tool).');
    const fn = isF ? `{${key.toUpperCase()}}` : NAMED[key] ? NAMED[key].win : key;
    const m = (mods.has('ctrl') ? '^' : '') + (mods.has('alt') ? '%' : '') + (mods.has('shift') ? '+' : '');
    const send = `${m}${fn}`.replace(/'/g, "''");
    return { cmd: 'powershell.exe', args: psArgs(`Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${send}')`) };
  }
  if (platform === 'darwin') {
    const using = [mods.has('cmd') && 'command down', mods.has('ctrl') && 'control down', mods.has('alt') && 'option down', mods.has('shift') && 'shift down'].filter(Boolean);
    const tail = using.length ? ` using {${using.join(', ')}}` : '';
    const body = isF ? `key code ${FKEYS[+key.slice(1)]}` : NAMED[key] ? `key code ${NAMED[key].mac}` : `keystroke "${key}"`;
    return { cmd: 'osascript', args: ['-e', `tell application "System Events" to ${body}${tail}`] };
  }
  const x = [mods.has('ctrl') && 'ctrl', mods.has('alt') && 'alt', mods.has('shift') && 'shift', mods.has('cmd') && 'super'].filter(Boolean);
  x.push(isF ? key.toUpperCase() : NAMED[key] ? NAMED[key].x : key);
  return { cmd: 'xdotool', args: ['key', '--clearmodifiers', x.join('+')] };
}

// ------------------------------------------------------------------ apps
const APP_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,59}$/;

function listAppsCommand(platform) {
  if (platform === 'win32') {
    return { cmd: 'powershell.exe', args: psArgs('Get-Process | Where-Object { $_.MainWindowTitle } | Sort-Object ProcessName -Unique | ForEach-Object { $_.ProcessName }') };
  }
  if (platform === 'darwin') {
    return { cmd: 'osascript', args: ['-e', 'tell application "System Events" to get name of (processes where background only is false)'] };
  }
  return { cmd: '/bin/sh', args: ['-c', 'ps -u "$(id -un)" -o comm= | sort -u | head -80'] };
}

function quitAppCommand(name, platform) {
  if (!APP_NAME.test(name)) throw new Error('That is not a usable app name.');
  if (platform === 'win32') {
    const n = name.replace(/\.exe$/i, '');
    return { cmd: 'powershell.exe', args: psArgs(`Get-Process -Name '${n}' -ErrorAction Stop | ForEach-Object { [void]$_.CloseMainWindow() }`) };
  }
  if (platform === 'darwin') return { cmd: 'osascript', args: ['-e', `tell application "${name}" to quit`] };
  return { cmd: 'pkill', args: ['-TERM', '-x', name] };
}

// ------------------------------------------------------------------ files
const OPEN_BLOCKED = /\.(exe|bat|cmd|com|msi|msp|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|jar|scr|lnk|reg|sh|command|app|pkg|dmg|appimage|desktop|hta|cpl|msc|dll|iso)$/i;

// ------------------------------------------------------------------ web pages
function isPrivateAddress(ip) {
  let a = String(ip).toLowerCase();
  const m = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (m) a = m[1];
  if (net.isIPv4(a)) {
    const [p, q] = a.split('.').map(Number);
    return p === 0 || p === 10 || p === 127 || p >= 224 || (p === 169 && q === 254) ||
      (p === 172 && q >= 16 && q <= 31) || (p === 192 && q === 168) || (p === 100 && q >= 64 && q <= 127);
  }
  if (net.isIPv6(a)) return a === '::1' || a === '::' || /^f[cd]/.test(a) || /^fe[89ab]/.test(a);
  return true; // not an IP we understand: treat as unsafe
}

function htmlToText(html) {
  return String(html)
    .replace(/<(script|style|noscript|svg|template|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|br)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n) => { try { return String.fromCodePoint(+n); } catch (_) { return ' '; } })
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ------------------------------------------------------------------ calendar event (.ics)
function icsEscape(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}
const pad = (n) => String(n).padStart(2, '0');

// start: 'YYYY-MM-DD' (all day) or 'YYYY-MM-DDTHH:MM' (local time)
function parseStart(start) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?$/.exec(String(start || '').trim());
  if (!m) throw new Error('The start must look like 2026-12-24 or 2026-12-24T18:30.');
  const [, y, mo, d, h, mi] = m;
  const date = new Date(+y, +mo - 1, +d, h ? +h : 0, mi ? +mi : 0);
  if (date.getFullYear() !== +y || date.getMonth() !== +mo - 1 || date.getDate() !== +d || (h && (+h > 23 || +mi > 59))) throw new Error('That date does not exist.');
  return { date, allDay: !h };
}
const icsLocal = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
const icsDay = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;

function buildIcs({ title, start, durationMinutes = 60, location = '', notes = '' }, now = new Date()) {
  const { date, allDay } = parseStart(start);
  const uid = `${now.getTime()}-${Math.random().toString(36).slice(2, 10)}@pip`;
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Pip//Desktop//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${stamp}`];
  if (allDay) {
    const next = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
    lines.push(`DTSTART;VALUE=DATE:${icsDay(date)}`, `DTEND;VALUE=DATE:${icsDay(next)}`);
  } else {
    const end = new Date(date.getTime() + Math.max(5, Math.min(1440, durationMinutes)) * 60000);
    lines.push(`DTSTART:${icsLocal(date)}`, `DTEND:${icsLocal(end)}`);
  }
  lines.push(`SUMMARY:${icsEscape(title)}`);
  if (location) lines.push(`LOCATION:${icsEscape(location)}`);
  if (notes) lines.push(`DESCRIPTION:${icsEscape(notes)}`);
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

module.exports = {
  PAGES, pageNames, settingsLaunch,
  psArgs, buildShell, shellName, checkCommand,
  parseCombo, buildKeyCommand,
  APP_NAME, listAppsCommand, quitAppCommand,
  OPEN_BLOCKED, isPrivateAddress, htmlToText,
  buildIcs, parseStart,
};
