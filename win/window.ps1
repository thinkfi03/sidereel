# Sidereel window helper for Windows.
# Finds the browser's app window, pins it always-on-top at the right edge, then reads
# "hide" / "show" lines from stdin and prints "visible 0|1".
# Usage: window.ps1 <browserPid> <width> <height> <x|-1> <y>
param([uint32]$BrowserPid, [int]$Width = 420, [int]$Height = 860, [int]$X = -1, [int]$Y = 60)

Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class SidereelWin {
    public delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr h);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
    public static IntPtr Find(uint pid) {
        IntPtr found = IntPtr.Zero;
        EnumWindows(delegate (IntPtr h, IntPtr l) {
            uint p; GetWindowThreadProcessId(h, out p);
            if (p == pid && IsWindowVisible(h) && GetWindowTextLength(h) > 0) { found = h; return false; }
            return true;
        }, IntPtr.Zero);
        return found;
    }
}
"@

function Say([string]$s) { [Console]::Out.WriteLine($s); [Console]::Out.Flush() }

$hwnd = [IntPtr]::Zero
for ($i = 0; $i -lt 80 -and $hwnd -eq [IntPtr]::Zero; $i++) {
    $hwnd = [SidereelWin]::Find($BrowserPid)
    if ($hwnd -eq [IntPtr]::Zero) { Start-Sleep -Milliseconds 250 }
}
if ($hwnd -eq [IntPtr]::Zero) { Say "nowindow"; exit 1 }

$TOPMOST = [IntPtr](-1)
$SWP_NOMOVE_NOSIZE_NOACTIVATE = 0x0002 -bor 0x0001 -bor 0x0010
$wa = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$left = if ($X -ge 0) { $X } else { $wa.Right - $Width }
$top = $wa.Top + $Y
[SidereelWin]::SetWindowPos($hwnd, $TOPMOST, $left, $top, $Width, $Height, 0x0010) | Out-Null
Say "visible 1"

while ($null -ne ($line = [Console]::In.ReadLine())) {
    switch ($line.Trim()) {
        'hide' { [SidereelWin]::ShowWindow($hwnd, 0) | Out-Null; Say "visible 0" }
        'show' {
            [SidereelWin]::ShowWindow($hwnd, 4) | Out-Null  # SW_SHOWNOACTIVATE
            [SidereelWin]::SetWindowPos($hwnd, $TOPMOST, 0, 0, 0, 0, $SWP_NOMOVE_NOSIZE_NOACTIVATE) | Out-Null
            Say "visible 1"
        }
    }
}
