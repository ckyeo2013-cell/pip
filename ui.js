'use strict';
/*
 * Lets Pip know where the buttons and boxes are WITHOUT taking a screenshot.
 *
 * Every OS publishes a text description of each window (the "accessibility tree", the
 * same data screen readers use): which buttons, boxes and links exist, what they are
 * called and where they sit. Small scripts read it and print JSON:
 *   Windows: UI Automation through PowerShell (nothing to install)
 *   macOS:   System Events through osascript/JXA (needs the Accessibility permission Pip already asks for)
 *   Linux:   AT-SPI through python3 + PyGObject (apps must expose accessibility)
 *
 * Only names, kinds and positions are read, never what is typed in a box, and password
 * boxes are skipped. Pip's own window is always ignored.
 *
 * Scripts get their input through the environment (PIP_UI), never pasted into the script text.
 */
const { psArgs } = require('./system');

const MAX_ELEMENTS = 400;
const ROLES = ['Button', 'CheckBox', 'RadioButton', 'ComboBox', 'Edit', 'Hyperlink', 'MenuItem', 'TabItem', 'ListItem', 'TreeItem', 'Slider'];
const EDIT_ROLES = ['Edit', 'ComboBox'];
// Buttons whose label suggests something hard to undo are shown in red on the approval card.
const RISKY = /\b(delete|remove|erase|wipe|format|uninstall|reset|clear|discard|send|submit|post|publish|pay|purchase|buy|order|checkout|confirm|sign out|log ?out|install|allow|grant|accept|agree|transfer|empty|restart|shut ?down|power|disable|turn off|quit|close all|don'?t save)\b/i;

const isRisky = (name) => RISKY.test(String(name || ''));

// ------------------------------------------------------------------ Windows (UI Automation)
const WIN_SCRIPT = `
$ErrorActionPreference = 'Stop'
try {
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -TypeDefinition @"
using System; using System.Text; using System.Runtime.InteropServices;
public static class PipWin {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern IntPtr GetTopWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint c);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
}
"@
[void][PipWin]::SetProcessDPIAware()
$in = $env:PIP_UI | ConvertFrom-Json
$pipPid = [uint32]$in.pipPid
$skip = @('Shell_TrayWnd','Shell_SecondaryTrayWnd','Progman','WorkerW','Windows.UI.Core.CoreWindow','NotifyIconOverflowWindow')
$h = [PipWin]::GetTopWindow([IntPtr]::Zero)
$win = [IntPtr]::Zero
while ($h -ne [IntPtr]::Zero) {
  if ([PipWin]::IsWindowVisible($h) -and -not [PipWin]::IsIconic($h)) {
    $p = [uint32]0
    [void][PipWin]::GetWindowThreadProcessId($h, [ref]$p)
    $cn = New-Object System.Text.StringBuilder 256; [void][PipWin]::GetClassName($h, $cn, 256)
    $tt = New-Object System.Text.StringBuilder 512; [void][PipWin]::GetWindowText($h, $tt, 512)
    if ($p -ne $pipPid -and $tt.Length -gt 0 -and ($skip -notcontains $cn.ToString())) { $win = $h; break }
  }
  $h = [PipWin]::GetWindow($h, 2)
}
if ($win -eq [IntPtr]::Zero) { ConvertTo-Json -InputObject @{ error = 'No other window is open to look at.' } -Compress; exit 0 }
$root = [Windows.Automation.AutomationElement]::FromHandle($win)
$names = @('Button','CheckBox','RadioButton','ComboBox','Edit','Hyperlink','MenuItem','TabItem','ListItem','TreeItem','Slider')
$conds = @(); foreach ($n in $names) { $conds += New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ControlTypeProperty, [Windows.Automation.ControlType]::$n) }
$or = [Windows.Automation.OrCondition]::new([Windows.Automation.Condition[]]$conds)
$cr = New-Object Windows.Automation.CacheRequest
foreach ($pr in @([Windows.Automation.AutomationElement]::NameProperty, [Windows.Automation.AutomationElement]::ControlTypeProperty, [Windows.Automation.AutomationElement]::BoundingRectangleProperty, [Windows.Automation.AutomationElement]::IsEnabledProperty, [Windows.Automation.AutomationElement]::HasKeyboardFocusProperty, [Windows.Automation.AutomationElement]::IsOffscreenProperty, [Windows.Automation.AutomationElement]::IsPasswordProperty)) { $cr.Add($pr) }
$all = $null
$act = $cr.Activate()
try { $all = $root.FindAll([Windows.Automation.TreeScope]::Descendants, $or) } finally { $act.Dispose() }
function RoleOf($el) { $n = $el.Cached.ControlType.ProgrammaticName; return ($n -replace '^ControlType\\.', '') }
$items = New-Object System.Collections.ArrayList
foreach ($el in $all) {
  if ($items.Count -ge ${MAX_ELEMENTS}) { break }
  $c = $el.Cached
  if ($c.IsOffscreen) { continue }
  $r = $c.BoundingRectangle
  if ([double]::IsInfinity($r.X) -or $r.Width -lt 4 -or $r.Height -lt 4) { continue }
  $role = RoleOf $el
  $name = [string]$c.Name
  if (-not $name -and $role -ne 'Edit' -and $role -ne 'ComboBox') { continue }
  [void]$items.Add(@{ role = $role; name = $name; x = [math]::Round($r.X); y = [math]::Round($r.Y); w = [math]::Round($r.Width); h = [math]::Round($r.Height); enabled = [bool]$c.IsEnabled; focused = [bool]$c.HasKeyboardFocus; secure = [bool]$c.IsPassword })
}
$wr = $root.Current.BoundingRectangle
$out = @{ window = @{ title = [string]$root.Current.Name; foreground = ([PipWin]::GetForegroundWindow() -eq $win); x = [math]::Round($wr.X); y = [math]::Round($wr.Y); w = [math]::Round($wr.Width); h = [math]::Round($wr.Height) }; units = 'px'; elements = @($items) }
if ($in.mode -eq 'list') { ConvertTo-Json -InputObject $out -Depth 5 -Compress; exit 0 }
# act on one element: find the closest one with the same name and kind
$best = $null; $bd = 1e9
foreach ($el in $all) {
  $c = $el.Cached
  if ([string]$c.Name -ne [string]$in.name -or (RoleOf $el) -ne $in.role) { continue }
  $r = $c.BoundingRectangle
  if ([double]::IsInfinity($r.X)) { continue }
  $d = [math]::Abs($r.X + $r.Width / 2 - $in.cx) + [math]::Abs($r.Y + $r.Height / 2 - $in.cy)
  if ($d -lt $bd) { $bd = $d; $best = $el }
}
if (-not $best -or $bd -gt 80) { ConvertTo-Json -InputObject @{ error = 'That item is no longer where it was. Look again with find_ui.' } -Compress; exit 0 }
if ($best.Current.IsPassword) { ConvertTo-Json -InputObject @{ error = 'Pip does not touch password boxes.' } -Compress; exit 0 }
if ($in.mode -eq 'focus') {
  $best.SetFocus()
  ConvertTo-Json -InputObject @{ ok = 'focused' } -Compress; exit 0
}
$pat = $null
if ($best.TryGetCurrentPattern([Windows.Automation.InvokePattern]::Pattern, [ref]$pat)) { $pat.Invoke(); ConvertTo-Json -InputObject @{ ok = 'pressed' } -Compress; exit 0 }
if ($best.TryGetCurrentPattern([Windows.Automation.TogglePattern]::Pattern, [ref]$pat)) { $pat.Toggle(); ConvertTo-Json -InputObject @{ ok = 'toggled' } -Compress; exit 0 }
if ($best.TryGetCurrentPattern([Windows.Automation.SelectionItemPattern]::Pattern, [ref]$pat)) { $pat.Select(); ConvertTo-Json -InputObject @{ ok = 'selected' } -Compress; exit 0 }
if ($best.TryGetCurrentPattern([Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$pat)) { $pat.Expand(); ConvertTo-Json -InputObject @{ ok = 'expanded' } -Compress; exit 0 }
ConvertTo-Json -InputObject @{ error = 'That item cannot be pressed without a mouse click.' } -Compress
} catch {
  ConvertTo-Json -InputObject @{ error = ('Could not read the window: ' + $_.Exception.Message) } -Compress
}
`;

// ------------------------------------------------------------------ macOS (System Events, JXA)
const MAC_SCRIPT = `
function run(argv) {
  var inp = JSON.parse(argv[0]);
  var se = Application('System Events');
  var front = se.processes.whose({ frontmost: true })();
  if (!front.length) return JSON.stringify({ error: 'No app is in front.' });
  var proc = front[0];
  if (proc.unixId() === inp.pipPid) return JSON.stringify({ error: 'Pip itself is in front. Click the app you want help with first.' });
  var wins = proc.windows();
  if (!wins.length) return JSON.stringify({ error: 'The front app has no open window.' });
  var win = wins[0];
  var map = { AXButton: 'Button', AXCheckBox: 'CheckBox', AXRadioButton: 'RadioButton', AXPopUpButton: 'ComboBox', AXComboBox: 'ComboBox',
    AXTextField: 'Edit', AXTextArea: 'Edit', AXSearchField: 'Edit', AXSecureTextField: 'Secure', AXLink: 'Hyperlink', AXMenuItem: 'MenuItem',
    AXMenuButton: 'Button', AXTab: 'TabItem', AXRow: 'ListItem', AXSlider: 'Slider', AXDisclosureTriangle: 'Button' };
  function safe(f) { try { return f(); } catch (e) { return null; } }
  var items = [], queue = [win], visited = 0, bound = {};
  var wp = safe(function () { return win.position(); }) || [0, 0], ws = safe(function () { return win.size(); }) || [0, 0];
  while (queue.length && visited < 700 && items.length < ${MAX_ELEMENTS}) {
    var el = queue.shift(); visited++;
    var raw = safe(function () { return el.role(); });
    var role = map[raw];
    if (role && role !== 'Secure') {
      var nm = safe(function () { return el.name(); }) || safe(function () { return el.title(); }) || safe(function () { return el.description(); }) || '';
      var pos = safe(function () { return el.position(); }), sz = safe(function () { return el.size(); });
      if (pos && sz && sz[0] >= 4 && sz[1] >= 4 && (nm || role === 'Edit')) {
        items.push({ role: role, name: String(nm), x: pos[0], y: pos[1], w: sz[0], h: sz[1],
          enabled: safe(function () { return el.enabled(); }) !== false, focused: safe(function () { return el.focused(); }) === true, secure: false, _el: el });
      }
    }
    if (raw === 'AXSecureTextField') continue;
    var kids = safe(function () { return el.uiElements(); }) || [];
    for (var k = 0; k < kids.length; k++) queue.push(kids[k]);
  }
  var out = { window: { title: String(safe(function () { return win.name(); }) || ''), app: String(safe(function () { return proc.name(); }) || ''), foreground: true, x: wp[0], y: wp[1], w: ws[0], h: ws[1] }, units: 'pt', elements: [] };
  if (inp.mode === 'list') {
    out.elements = items.map(function (i) { delete i._el; return i; });
    return JSON.stringify(out);
  }
  var best = null, bd = 1e9;
  items.forEach(function (i) {
    if (i.name !== inp.name || i.role !== inp.role) return;
    var d = Math.abs(i.x + i.w / 2 - inp.cx) + Math.abs(i.y + i.h / 2 - inp.cy);
    if (d < bd) { bd = d; best = i; }
  });
  if (!best || bd > 80) return JSON.stringify({ error: 'That item is no longer where it was. Look again with find_ui.' });
  if (inp.mode === 'focus') { best._el.focused = true; return JSON.stringify({ ok: 'focused' }); }
  best._el.click();
  return JSON.stringify({ ok: 'pressed' });
}
`;

// ------------------------------------------------------------------ Linux (AT-SPI)
const LINUX_SCRIPT = `
import sys, json
try:
    import gi
    gi.require_version('Atspi', '2.0')
    from gi.repository import Atspi
except Exception:
    print(json.dumps({'error': 'Seeing buttons on Linux needs python3-gi and gir1.2-atspi-2.0 (and an app that exposes accessibility).'})); sys.exit(0)
inp = json.loads(sys.argv[1])
ROLE = {'push button': 'Button', 'toggle button': 'Button', 'check box': 'CheckBox', 'radio button': 'RadioButton', 'combo box': 'ComboBox',
        'text': 'Edit', 'entry': 'Edit', 'link': 'Hyperlink', 'menu item': 'MenuItem', 'page tab': 'TabItem', 'list item': 'ListItem', 'slider': 'Slider'}
def active_window():
    desk = Atspi.get_desktop(0)
    for i in range(desk.get_child_count()):
        app = desk.get_child_at_index(i)
        try:
            if app.get_process_id() == inp['pipPid']: continue
            for j in range(app.get_child_count()):
                w = app.get_child_at_index(j)
                if w.get_state_set().contains(Atspi.StateType.ACTIVE): return app, w
        except Exception: pass
    return None, None
app, win = active_window()
if win is None:
    print(json.dumps({'error': 'No active window with accessibility support was found.'})); sys.exit(0)
items, queue = [], [win]
while queue and len(items) < ${MAX_ELEMENTS} and len(queue) < 5000:
    el = queue.pop(0)
    try:
        rn = el.get_role_name()
        role = ROLE.get(rn)
        if rn == 'password text': continue
        if role:
            comp = el.get_component_iface()
            ext = comp.get_extents(Atspi.CoordType.SCREEN) if comp else None
            st = el.get_state_set()
            if ext and ext.width >= 4 and ext.height >= 4 and st.contains(Atspi.StateType.SHOWING) and (el.get_name() or role == 'Edit'):
                items.append({'role': role, 'name': el.get_name() or '', 'x': ext.x, 'y': ext.y, 'w': ext.width, 'h': ext.height,
                              'enabled': st.contains(Atspi.StateType.ENABLED), 'focused': st.contains(Atspi.StateType.FOCUSED), 'secure': False, '_el': el})
        for k in range(el.get_child_count()): queue.append(el.get_child_at_index(k))
    except Exception: pass
we = None
try: we = win.get_component_iface().get_extents(Atspi.CoordType.SCREEN)
except Exception: pass
out = {'window': {'title': win.get_name() or '', 'app': app.get_name() or '', 'foreground': True, 'x': we.x if we else 0, 'y': we.y if we else 0, 'w': we.width if we else 0, 'h': we.height if we else 0}, 'units': 'px',
       'elements': [{k: v for k, v in i.items() if k != '_el'} for i in items]}
if inp['mode'] == 'list':
    print(json.dumps(out)); sys.exit(0)
best, bd = None, 1e9
for i in items:
    if i['name'] != inp.get('name') or i['role'] != inp.get('role'): continue
    d = abs(i['x'] + i['w'] / 2 - inp['cx']) + abs(i['y'] + i['h'] / 2 - inp['cy'])
    if d < bd: bd, best = d, i
if best is None or bd > 80:
    print(json.dumps({'error': 'That item is no longer where it was. Look again with find_ui.'})); sys.exit(0)
try:
    if inp['mode'] == 'focus':
        best['_el'].get_component_iface().grab_focus(); print(json.dumps({'ok': 'focused'})); sys.exit(0)
    act = best['_el'].get_action_iface()
    if act and act.get_n_actions() > 0:
        act.do_action(0); print(json.dumps({'ok': 'pressed'})); sys.exit(0)
    print(json.dumps({'error': 'That item cannot be pressed without a mouse click.'}))
except Exception as e:
    print(json.dumps({'error': 'Could not do that: ' + str(e)}))
`;

// ------------------------------------------------------------------ building commands
// mode: 'list' | 'press' | 'focus'. target (press/focus): { name, role, cx, cy } in the same units the list printed.
function buildCommand(platform, { mode, pipPid, target }) {
  if (!['list', 'press', 'focus'].includes(mode)) throw new Error('Unknown UI mode.');
  const input = JSON.stringify({ mode, pipPid: Number(pipPid) || 0, ...(target || {}) });
  if (platform === 'win32') {
    return { cmd: 'powershell.exe', args: psArgs(WIN_SCRIPT), env: { PIP_UI: input }, timeout: 25000 };
  }
  if (platform === 'darwin') {
    return { cmd: 'osascript', args: ['-l', 'JavaScript', '-e', MAC_SCRIPT, input], env: {}, timeout: 40000 };
  }
  return { cmd: 'python3', args: ['-c', LINUX_SCRIPT, input], env: {}, timeout: 25000 };
}

// Reads the JSON the scripts print (the last JSON line, in case a tool printed noise first).
function parseOutput(stdout) {
  const lines = String(stdout || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i][0] !== '{') continue;
    try { return JSON.parse(lines[i]); } catch (_) { /* keep looking */ }
  }
  throw new Error('Could not read the window. The app may not share accessibility information.');
}

// Turns raw rectangles into things Pip can use: numbered elements with centre points in
// "screen units" (DIPs, what Electron uses) and fractions (0..1) of Pip's flying area.
// info = { workArea: {x,y,width,height}, scaleFactor }
function normalize(raw, platform, info) {
  const sf = platform === 'darwin' ? 1 : (info.scaleFactor || 1);
  const wa = info.workArea;
  const dip = (v) => v / sf;
  const frac = (px, py) => ({ fx: (px - wa.x) / wa.width, fy: (py - wa.y) / wa.height });
  const out = [];
  let skippedOffscreen = 0;
  for (const e of raw.elements || []) {
    if (e.secure) continue;
    const x = dip(e.x), y = dip(e.y), w = dip(e.w), h = dip(e.h);
    const cx = x + w / 2;
    const f = frac(cx, y + Math.min(8, h / 2)); // top edge: Pip perches just above the thing
    if (f.fx < 0 || f.fx > 1 || f.fy < 0 || f.fy > 1) { skippedOffscreen++; continue; }
    out.push({
      id: out.length + 1,
      role: String(e.role),
      name: String(e.name || '').replace(/\s+/g, ' ').trim().slice(0, 80),
      enabled: e.enabled !== false,
      focused: !!e.focused,
      raw: { cx: Math.round(e.x + e.w / 2), cy: Math.round(e.y + e.h / 2) }, // in the script's own units, for re-finding it
      fx: Math.round(f.fx * 1000) / 1000,
      fy: Math.round(f.fy * 1000) / 1000,
    });
  }
  return { window: raw.window || {}, elements: out, skippedOffscreen };
}

function describe(el) {
  const label = el.name ? `"${el.name}"` : '(unnamed)';
  return `[${el.id}] ${el.role} ${label}${el.enabled ? '' : ' (disabled)'}${el.focused ? ' (has the cursor)' : ''} at x=${el.fx}, y=${el.fy}`;
}

// Terminals run whatever is pasted into them, so Pip never auto-types into one.
const TERMINAL = /terminal|iterm|powershell|command prompt|cmd\.exe|konsole|xterm|alacritty|kitty|wezterm|ghostty|warp|tmux|\bssh\b|\bbash\b|\bzsh\b/i;
const looksLikeTerminal = (w) => TERMINAL.test(`${(w && w.title) || ''} ${(w && w.app) || ''}`);

// The text box that has the cursor right now, if there is one and it is safe to type into.
function focusedEditable(norm) {
  return (norm.elements || []).find((e) => e.focused && EDIT_ROLES.includes(e.role) && e.enabled) || null;
}

module.exports = { buildCommand, parseOutput, normalize, describe, focusedEditable, looksLikeTerminal, isRisky, MAX_ELEMENTS, ROLES, EDIT_ROLES };
