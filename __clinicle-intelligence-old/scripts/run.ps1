#Requires -Version 5.1
<#
.SYNOPSIS
    Clinicle Intelligence installer & management script for Windows.
.DESCRIPTION
    One-liner install:
      irm https://cdn.link-ai.tech/code/cow/run.ps1 | iex
    Or from a local clone:
      .\scripts\run.ps1              # install / configure
      .\scripts\run.ps1 start        # start service  (delegates to clinicle CLI)
      .\scripts\run.ps1 stop|restart|status|logs|config|update|help
#>

param(
    [Parameter(Position = 0)]
    [string]$Command = ""
)

$ErrorActionPreference = "Stop"

# ── ensure UTF-8 everywhere on Windows ───────────────────────────
# Without this, Chinese text renders as mojibake (e.g. "éæ©") on Windows
# PowerShell 5.1, whose console defaults to the system ANSI code page (GBK on
# Chinese systems). Set the active code page AND the console encodings so both
# our output and any child process (git/python) speak UTF-8.
try { chcp 65001 | Out-Null } catch {}
try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    [Console]::InputEncoding  = [System.Text.Encoding]::UTF8
} catch {}
# $OutputEncoding controls how strings are piped to external programs.
$OutputEncoding = [System.Text.Encoding]::UTF8
$env:PYTHONIOENCODING = "utf-8"

# ── disable console QuickEdit mode ───────────────────────────────
# On Windows, QuickEdit is ON by default: a stray click/selection in the
# window FREEZES all output until the user presses a key. During long steps
# (git clone, pip install) this looks like a hang, and the wake-up key gets
# buffered and later auto-confirms a menu default. Turning QuickEdit off
# removes both the freeze and the phantom keystrokes.
try {
    if (-not ([Console]::IsInputRedirected)) {
        $quickEditType = @'
using System;
using System.Runtime.InteropServices;
public static class ConsoleQuickEdit {
    const int  STD_INPUT_HANDLE   = -10;
    const uint ENABLE_QUICK_EDIT  = 0x0040;
    const uint ENABLE_EXTENDED    = 0x0080;
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr GetStdHandle(int nStdHandle);
    [DllImport("kernel32.dll")]
    static extern bool GetConsoleMode(IntPtr hConsoleHandle, out uint lpMode);
    [DllImport("kernel32.dll")]
    static extern bool SetConsoleMode(IntPtr hConsoleHandle, uint dwMode);
    public static void Disable() {
        IntPtr handle = GetStdHandle(STD_INPUT_HANDLE);
        uint mode;
        if (!GetConsoleMode(handle, out mode)) { return; }
        mode &= ~ENABLE_QUICK_EDIT;   // clear QuickEdit
        mode |=  ENABLE_EXTENDED;     // keep extended flags valid
        SetConsoleMode(handle, mode);
    }
}
'@
        if (-not ([System.Management.Automation.PSTypeName]'ConsoleQuickEdit').Type) {
            Add-Type -TypeDefinition $quickEditType -ErrorAction Stop
        }
        [ConsoleQuickEdit]::Disable()
    }
} catch {}

# ── colours ──────────────────────────────────────────────────────
function Write-Clinicle   { param([string]$M) Write-Host $M -ForegroundColor Green  }
function Write-Warn  { param([string]$M) Write-Host $M -ForegroundColor Yellow }
function Write-Err   { param([string]$M) Write-Host $M -ForegroundColor Red    }
function Write-Info  { param([string]$M) Write-Host $M -ForegroundColor Cyan   }

# $UiLang is always "en" -- kept as a variable (rather than deleting the T
# helper and every call site) because it's cheap insurance against reverting
# this by hand later.
$script:UiLang = "en"


function T {
    param([string]$En)
    return $En
}

# ── detect project directory ─────────────────────────────────────
$ScriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { $PWD.Path }
$BaseDir   = Split-Path $ScriptDir -Parent

$IsProjectDir = (Test-Path "$BaseDir\app.py") -and (Test-Path "$BaseDir\config-template.json")
if (-not $IsProjectDir) {
    $BaseDir = $PWD.Path
    $IsProjectDir = (Test-Path "$BaseDir\app.py") -and (Test-Path "$BaseDir\config-template.json")
}

# Initialize $UiLang for management commands: prefer cow_lang from an existing
# config.json, otherwise fall back to environment detection.
function Initialize-UiLang {
    $script:UiLang = "en"
}

# Drain any buffered console keystrokes. During long steps (git clone, pip
# install) users often hit Enter to "wake up" a seemingly stuck console; those
# keys sit in the input buffer and would otherwise be consumed by the next
# ReadKey, auto-confirming a menu's default. Flush them before reading input.
function Clear-InputBuffer {
    try {
        if ([Console]::IsInputRedirected) { return }
        while ([Console]::KeyAvailable) { [void][Console]::ReadKey($true) }
    } catch {}
}

# ── arrow-key selectable menu with number fallback ───────────────
# Usage: $idx = Select-Menu -Title "..." -Options @("a","b") [-Default 1]
# Returns the selected 1-based index.
function Select-Menu {
    param(
        [string]$Title,
        [string[]]$Options,
        [int]$Default = 1
    )
    $count = $Options.Count
    $cur = [Math]::Max(0, [Math]::Min($Default - 1, $count - 1))

    # Fallback to numbered input when there is no interactive console
    # (e.g. piped input, redirected host).
    $interactive = $true
    try {
        if ([Console]::IsInputRedirected) { $interactive = $false }
    } catch { $interactive = $false }

    if (-not $interactive) {
        Write-Info $Title
        for ($i = 0; $i -lt $count; $i++) {
            Write-Host ("  {0}) {1}" -f ($i + 1), $Options[$i])
        }
        do {
            $sel = Read-Host (T "Enter number") 
            if (-not $sel) { $sel = "$($cur + 1)" }
        } while ($sel -notmatch '^\d+$' -or [int]$sel -lt 1 -or [int]$sel -gt $count)
        return [int]$sel
    }

    Write-Info $Title
    Write-Host (T "Use ↑/↓ to move, Enter to select") -ForegroundColor Cyan

    # Discard keystrokes buffered during the previous (possibly long-running)
    # step so a leftover Enter doesn't instantly confirm the default option.
    Clear-InputBuffer

    [Console]::CursorVisible = $false
    $firstDraw = $true
    try {
        while ($true) {
            if (-not $firstDraw) {
                # Move cursor up to the top of the option block to redraw it.
                $top = [Console]::CursorTop - $count
                if ($top -lt 0) { $top = 0 }
                [Console]::SetCursorPosition(0, $top)
            }
            $firstDraw = $false

            for ($i = 0; $i -lt $count; $i++) {
                # Clear the line first to avoid leftover characters.
                Write-Host (" " * ([Console]::WindowWidth - 1)) -NoNewline
                [Console]::SetCursorPosition(0, [Console]::CursorTop)
                if ($i -eq $cur) {
                    Write-Host ("  > " + $Options[$i]) -ForegroundColor Green
                } else {
                    Write-Host ("    " + $Options[$i])
                }
            }

            $key = [Console]::ReadKey($true)
            switch ($key.Key) {
                "UpArrow"   { $cur = (($cur - 1 + $count) % $count) }
                "DownArrow" { $cur = (($cur + 1) % $count) }
                "Enter"     { return ($cur + 1) }
                default {
                    # Number shortcut (1-9) jumps to that option and confirms.
                    $ch = $key.KeyChar
                    if ($ch -match '^[1-9]$') {
                        $n = [int]"$ch"
                        if ($n -ge 1 -and $n -le $count) { return $n }
                    }
                }
            }
        }
    } finally {
        [Console]::CursorVisible = $true
    }
}

# Install/UI language is English-only now (product UI is English/Arabic,
# not this installer) -- no prompt, no detection, just set it.
function Select-Language {
    $script:UiLang = "en"
    $script:InstallLang = "en"
}

# ── Python detection ─────────────────────────────────────────────
function Find-Python {
    # 3.13 compatibility is not great, so prefer 3.7-3.12 and only fall back to 3.13.
    $fallback = $null
    foreach ($cmd in @("python3", "python")) {
        $bin = Get-Command $cmd -ErrorAction SilentlyContinue
        if (-not $bin) { continue }
        try {
            $ver = & $bin.Source -c "import sys; v=sys.version_info; print(f'{v.major}.{v.minor}')" 2>$null
            $parts = $ver -split '\.'
            $major = [int]$parts[0]; $minor = [int]$parts[1]
            if ($major -eq 3 -and $minor -ge 7 -and $minor -le 12) {
                return $bin.Source
            }
            if ($major -eq 3 -and $minor -eq 13 -and -not $fallback) {
                $fallback = $bin.Source
            }
        } catch {}
    }
    return $fallback
}

$PythonCmd = Find-Python
function Assert-Python {
    if (-not $PythonCmd) {
        Write-Err (T "Python 3.7-3.13 not found. Please install from https://www.python.org/downloads/")
        Read-Host (T "Press Enter to exit")
        exit 1
    }
    Write-Clinicle ((T "Found Python") + ": $PythonCmd")
}

# ── clone project ────────────────────────────────────────────────
function Install-Project {
    if (Test-Path "CowAgent") {
        # Auto-backup the existing directory without prompting.
        $backup = "CowAgent_backup_$(Get-Date -Format 'yyyyMMddHHmmss')"
        Rename-Item "CowAgent" $backup
        Write-Warn ((T "Existing 'CowAgent' directory backed up to") + " '$backup'")
    }

    $gitBin = Get-Command git -ErrorAction SilentlyContinue
    if (-not $gitBin) {
        Write-Err (T "Git not found. Please install from https://git-scm.com/download/win")
        Read-Host (T "Press Enter to exit")
        exit 1
    }

    Write-Clinicle (T "Cloning Clinicle Intelligence project...")
    $cloneOk = $false

    # Test GitHub connectivity before attempting clone
    try {
        $null = Invoke-WebRequest -Uri "https://github.com" -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
        Write-Clinicle (T "GitHub is reachable, cloning from GitHub...")
        $prevEAP = $ErrorActionPreference; $ErrorActionPreference = "Continue"
        git clone --depth 10 --progress "https://github.com/zhayujie/CowAgent.git" 2>&1 | ForEach-Object { Write-Host $_ }
        if ($LASTEXITCODE -eq 0) { $cloneOk = $true }
        $ErrorActionPreference = $prevEAP
        if (-not $cloneOk) {
            if (Test-Path "CowAgent") { Remove-Item -Recurse -Force "CowAgent" }
        }
    } catch {}

    if (-not $cloneOk) {
        Write-Warn (T "GitHub clone failed or timed out, switching to Gitee mirror...")
        $prevEAP = $ErrorActionPreference; $ErrorActionPreference = "Continue"
        git clone --depth 10 --progress "https://gitee.com/zhayujie/CowAgent.git" 2>&1 | ForEach-Object { Write-Host $_ }
        if ($LASTEXITCODE -eq 0) { $cloneOk = $true }
        $ErrorActionPreference = $prevEAP
        if (-not $cloneOk) {
            if (Test-Path "CowAgent") { Remove-Item -Recurse -Force "CowAgent" }
        }
    }

    if (-not $cloneOk) {
        Write-Err (T "Clone failed from both GitHub and Gitee. Please check your network connection.")
        Write-Err (T "You can also manually clone: git clone https://gitee.com/zhayujie/CowAgent.git")
        Read-Host (T "Press Enter to exit")
        exit 1
    }

    Set-Location "CowAgent"
    $script:BaseDir = $PWD.Path
    $script:IsProjectDir = $true
    Write-Clinicle ((T "Project cloned") + ": $BaseDir")
}

# Test whether a URL is reachable within a short timeout. Uses a HEAD request
# and hides progress so it never blocks the UI for long. Any failure (DNS, TLS,
# timeout) just returns $false so the caller falls back gracefully.
function Test-UrlReachable {
    param([string]$Url, [int]$TimeoutSec = 4)
    $oldPP = $ProgressPreference; $ProgressPreference = "SilentlyContinue"
    try {
        $null = Invoke-WebRequest -Uri $Url -Method Head -UseBasicParsing -TimeoutSec $TimeoutSec -ErrorAction Stop
        return $true
    } catch {
        return $false
    } finally {
        $ProgressPreference = $oldPP
    }
}

# Official PyPI first; only fall back to the Tsinghua mirror if PyPI is
# unreachable. Returns an args array to splat into pip (empty = pip default).
function Get-PipMirrorArgs {
    $tuna = "https://pypi.tuna.tsinghua.edu.cn/simple"
    $pypi = "https://pypi.org/simple"
    if ((-not (Test-UrlReachable "$pypi/")) -and (Test-UrlReachable "$tuna/")) {
        Write-Warn ((T "Using pip mirror") + ": $tuna")
        return @("-i", $tuna)
    }
    return @()
}

# ── install dependencies ─────────────────────────────────────────
function Install-Dependencies {
    Write-Clinicle (T "Installing dependencies...")

    # Probe the mirror first (with progress hidden so the slow IWR call doesn't
    # leave the screen blank for too long).
    $oldPP = $ProgressPreference; $ProgressPreference = "SilentlyContinue"
    $pipMirror = Get-PipMirrorArgs
    $ProgressPreference = $oldPP

    # Keep pip output VISIBLE (do not pipe to Out-Null): on slow networks the
    # download can take minutes, and a silent step looks like a hang.
    $prevEAP = $ErrorActionPreference; $ErrorActionPreference = "Continue"

    Write-Info (T "Upgrading pip and basic tools...")
    & $PythonCmd -m pip install --upgrade pip setuptools wheel @pipMirror

    Write-Info (T "Installing project dependencies (may take a few minutes)...")
    # --prefer-binary: avoid building C extensions (e.g. aiohttp) from source,
    # which would require Microsoft C++ Build Tools that most users don't have.
    & $PythonCmd -m pip install --prefer-binary -r "$BaseDir\requirements.txt" @pipMirror
    $pipExit = $LASTEXITCODE
    $ErrorActionPreference = $prevEAP
    if ($pipExit -ne 0) {
        Write-Warn (T "Some dependencies may have issues, but continuing...")
    }

    # Register the CLI command via editable install (silent -- internal
    # detail, not something the user needs to see).
    $prevEAP = $ErrorActionPreference; $ErrorActionPreference = "Continue"
    & $PythonCmd -m pip install -e $BaseDir @pipMirror 2>&1 | Out-Null
    $ErrorActionPreference = $prevEAP

    # Add the Scripts dir (where pip puts clinicle.exe) to PATH, both for this
    # session and persistently, so `clinicle` keeps working after a reboot.
    $scriptsDir = & $PythonCmd -c "import sysconfig; print(sysconfig.get_path('scripts'))" 2>$null
    if ($scriptsDir -and (Test-Path $scriptsDir)) {
        Add-ScriptsDirToPath $scriptsDir
    }

    # Optional: bundle ripgrep for a faster search_files tool. Never fatal.
    Install-Ripgrep
}

# ── install ripgrep (best-effort) ────────────────────────────────
# Bundle a fast search backend for the search_files tool. This is OPTIONAL: the search_files
# tool falls back to PowerShell / pure-Python when rg is absent, so ANY failure
# here (no network, download error, unzip error) is swallowed with a warning
# and never blocks the install. We drop rg.exe into the Python Scripts dir,
# which the installer already puts on PATH, so shutil.which("rg") finds it.
function Install-Ripgrep {
    $RgVersion = "15.2.0"
    try {
        # Already available on PATH? Nothing to do.
        if (Get-Command rg -ErrorAction SilentlyContinue) {
            Write-Clinicle (T "ripgrep (rg) already available, skipping")
            return
        }

        # Target the Python Scripts dir (already on PATH from Install-Dependencies).
        $scriptsDir = & $PythonCmd -c "import sysconfig; print(sysconfig.get_path('scripts'))" 2>$null
        if (-not $scriptsDir -or -not (Test-Path $scriptsDir)) {
            Write-Warn (T "Skipping ripgrep install (no scripts dir); built-in fallback search will be used")
            return
        }
        $rgTarget = Join-Path $scriptsDir "rg.exe"
        if (Test-Path $rgTarget) { return }

        Write-Clinicle (T "Installing ripgrep (faster file search)...")

        $asset = "ripgrep-$RgVersion-x86_64-pc-windows-msvc.zip"
        # GitHub first, then the jsDelivr/Gitee-style mirror for zh networks.
        $urls = @(
            "https://github.com/BurntSushi/ripgrep/releases/download/$RgVersion/$asset",
            "https://cdn.link-ai.tech/code/cow/vendor/$asset"
        )

        $tmpZip = Join-Path $env:TEMP "cow-$asset"
        $tmpDir = Join-Path $env:TEMP "cow-rg-$([guid]::NewGuid().ToString('N'))"
        $downloaded = $false
        foreach ($u in $urls) {
            try {
                $oldPP = $ProgressPreference; $ProgressPreference = "SilentlyContinue"
                Invoke-WebRequest -Uri $u -OutFile $tmpZip -UseBasicParsing -TimeoutSec 30 -ErrorAction Stop
                $ProgressPreference = $oldPP
                $downloaded = $true
                break
            } catch {
                $ProgressPreference = $oldPP
            }
        }
        if (-not $downloaded) {
            Write-Warn (T "ripgrep download failed; built-in fallback search will be used (no impact)")
            return
        }

        # Extract and pull just rg.exe out of the archive's nested folder.
        New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null
        Expand-Archive -Path $tmpZip -DestinationPath $tmpDir -Force
        $rgExe = Get-ChildItem -Path $tmpDir -Recurse -Filter "rg.exe" | Select-Object -First 1
        if ($rgExe) {
            Copy-Item $rgExe.FullName $rgTarget -Force
            Write-Clinicle ((T "ripgrep installed") + ": $rgTarget")
        } else {
            Write-Warn (T "ripgrep extraction failed; built-in fallback search will be used")
        }

        # Best-effort cleanup of temp files.
        try { Remove-Item $tmpZip -Force -ErrorAction SilentlyContinue } catch {}
        try { Remove-Item $tmpDir -Recurse -Force -ErrorAction SilentlyContinue } catch {}
    } catch {
        # Never let an rg install problem break the main install flow.
        Write-Warn (T "ripgrep install skipped (no impact); built-in fallback search will be used")
    }
}

# Add the Python Scripts dir to PATH for this session and persist it to the
# user PATH (User scope needs no admin rights), so `clinicle` survives a reboot.
function Add-ScriptsDirToPath {
    param([string]$ScriptsDir)

    if ($env:PATH -notlike "*$ScriptsDir*") {
        $env:PATH = "$ScriptsDir;$env:PATH"
    }

    # Persist to the User PATH only if missing from BOTH User and Machine scopes
    # (checking Machine avoids a duplicate when Python is installed for all
    # users). Read raw scope values, not the already-merged $env:PATH.
    try {
        $target = $ScriptsDir.TrimEnd('\')
        $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
        $machinePath = ""
        try { $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine") } catch {}

        $allParts = @()
        foreach ($p in @($userPath, $machinePath)) {
            if ($p) { $allParts += ($p -split ';' | Where-Object { $_ -ne "" }) }
        }
        $already = $allParts | Where-Object { $_.TrimEnd('\') -ieq $target }
        if (-not $already) {
            $newPath = if ($userPath) { "$userPath;$ScriptsDir" } else { $ScriptsDir }
            [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
            Write-Clinicle ((T "Added clinicle command directory to user PATH (persists after reboot)") + ": $ScriptsDir")
        }
    } catch {
        Write-Warn (T "Could not persist PATH automatically; you may need to reconfigure after reboot.")
    }
}

# ── model selection ──────────────────────────────────────────────
# Order mirrors run.sh: DeepSeek, Claude, Gemini, OpenAI, MiniMax, Zhipu,
# Qwen, Doubao, Kimi, LinkAI, then Skip (11th option).
# Each entry: Provider / default model name / config key field / optional base.
$ModelChoices = @{
    1  = @{ Provider = "DeepSeek";                Default = "deepseek-flash";                      Field = "deepseek_api_key" }
    2  = @{ Provider = "Claude";                  Default = "claude-opus-5";                       Field = "claude_api_key";    BaseField = "claude_api_base" }
    3  = @{ Provider = "Gemini";                  Default = "gemini-3.1-pro-preview";              Field = "gemini_api_key";    BaseField = "gemini_api_base" }
    4  = @{ Provider = "OpenAI";                  Default = "gpt-5.6-luna";                        Field = "open_ai_api_key";   BaseField = "open_ai_api_base" }
    5  = @{ Provider = "MiniMax";                 Default = "MiniMax-M3";                          Field = "minimax_api_key" }
    6  = @{ Provider = "GLM";                     Default = "glm-5.3-flash";                       Field = "zhipu_ai_api_key" }
    7  = @{ Provider = "Qwen (DashScope)";        Default = "qwen3.8-flash";                       Field = "dashscope_api_key" }
    8  = @{ Provider = "Doubao (Volcengine Ark)"; Default = "doubao-seed-2-1-pro-260628"; Field = "ark_api_key" }
    9  = @{ Provider = "Kimi (Moonshot)";         Default = "kimi-k3";                             Field = "moonshot_api_key" }
    10 = @{ Provider = "MiMo";                    Default = "mimo-v2.5-pro";                       Field = "mimo_api_key" }
    11 = @{ Provider = "LinkAI";                  Default = "deepseek-flash";                      Field = "linkai_api_key";    Linkai = $true }
}

function Select-Model {
    Write-Host ""
    $title = T "Select AI Model"
    $options = @(
        "DeepSeek (deepseek-flash, deepseek-v4-pro, etc.)",
        "Claude (claude-opus-5, claude-sonnet-5, etc.)",
        "Gemini (gemini-3.5-flash, gemini-3.1-pro-preview, etc.)",
        "OpenAI (gpt-5.6-luna, etc.)",
        "MiniMax (MiniMax-M3, etc.)",
        "GLM (glm-5.3-flash, glm-5.3, etc.)",
        "Qwen (qwen3.8-flash, qwen3.8-max, etc.)",
        "Doubao (doubao-seed-2.1, etc.)",
        "Kimi (kimi-k3, etc.)",
        "MiMo (mimo-v2.5-pro, etc.)",
        ("LinkAI (" + (T "access all models via one API") + ")"),
        (T "⏭  Skip (configure later in the web console)")
    )
    $script:ModelChoice = Select-Menu -Title $title -Options $options -Default 1
}

# Configure model. Only ask for the API key; model name and base default to
# sensible values and can be changed later in the web console.
function Configure-Model {
    # Reset model-related state
    $script:ModelName    = ""
    $script:ModelField   = ""
    $script:ApiKey       = ""
    $script:ApiBase      = ""
    $script:ApiBaseField = ""
    $script:UseLinkai    = $false

    if ($script:ModelChoice -eq 12) {
        # Skip: leave model unset, will be configured in the web console.
        Write-Warn (T "Model configuration skipped, you can set it later in the web console")
        return
    }

    $m = $ModelChoices[$script:ModelChoice]
    Write-Clinicle ((T "Configuring") + " $($m.Provider)...")
    # Show where to obtain a LinkAI key.
    if ($m.Linkai) {
        Write-Info ((T "Get your LinkAI Key") + ": https://link-ai.tech/console/interface")
    }
    $hint = T "press Enter to skip, set later in web console"
    $script:ApiKey     = Read-Host ((T "Enter") + " $($m.Provider) API Key ($hint)")
    $script:ModelName  = $m.Default
    $script:ModelField = $m.Field
    if ($m.BaseField) { $script:ApiBaseField = $m.BaseField }
    if ($m.Linkai)    { $script:UseLinkai = $true }
}


# Configure channel, dispatched by stable channel key (not menu position).
function Configure-Channel {
    $script:ChannelExtra = @{}
    $script:AccessInfo = ""

    switch ($script:ChannelChoice) {
        { $_ -eq "web" -or $_ -eq "skip" } {
            # Web (also the default when skipped). Default port, no prompt.
            $script:ChannelType = "web"
            $script:ChannelExtra["web_port"] = 9899
            $script:AccessInfo = (T "Web console") + " : http://localhost:9899/chat"
        }
        "weixin" {
            $script:ChannelType = "weixin"
            $script:AccessInfo = T "Weixin channel configured. Scan QR code in terminal or web console to login."
        }
        "feishu" {
            $script:ChannelType = "feishu"
            Write-Clinicle (T "Configure Feishu (WebSocket mode)...")
            $script:ChannelExtra["feishu_app_id"]     = Read-Host (T "Enter Feishu App ID")
            $script:ChannelExtra["feishu_app_secret"] = Read-Host (T "Enter Feishu App Secret")
            $script:ChannelExtra["feishu_event_mode"] = "websocket"
            $script:AccessInfo = T "Feishu channel configured (WebSocket mode)"
        }
        "dingtalk" {
            $script:ChannelType = "dingtalk"
            Write-Clinicle (T "Configure DingTalk...")
            $script:ChannelExtra["dingtalk_client_id"]     = Read-Host (T "Enter DingTalk Client ID")
            $script:ChannelExtra["dingtalk_client_secret"] = Read-Host (T "Enter DingTalk Client Secret")
            $script:AccessInfo = T "DingTalk channel configured"
        }
        "wecom_bot" {
            $script:ChannelType = "wecom_bot"
            Write-Clinicle (T "Configure WeCom Bot...")
            $script:ChannelExtra["wecom_bot_id"]     = Read-Host (T "Enter WeCom Bot ID")
            $script:ChannelExtra["wecom_bot_secret"] = Read-Host (T "Enter WeCom Bot Secret")
            $script:AccessInfo = T "WeCom Bot channel configured"
        }
        "qq" {
            $script:ChannelType = "qq"
            Write-Clinicle (T "Configure QQ Bot...")
            $script:ChannelExtra["qq_app_id"]     = Read-Host (T "Enter QQ App ID")
            $script:ChannelExtra["qq_app_secret"] = Read-Host (T "Enter QQ App Secret")
            $script:AccessInfo = T "QQ Bot channel configured"
        }
        "wechatcom_app" {
            $script:ChannelType = "wechatcom_app"
            Write-Clinicle (T "Configure WeCom App...")
            $script:ChannelExtra["wechatcom_corp_id"]     = Read-Host (T "Enter WeChat Corp ID")
            $script:ChannelExtra["wechatcomapp_token"]    = Read-Host (T "Enter WeChat Com App Token")
            $script:ChannelExtra["wechatcomapp_secret"]   = Read-Host (T "Enter WeChat Com App Secret")
            $script:ChannelExtra["wechatcomapp_agent_id"] = Read-Host (T "Enter WeChat Com App Agent ID")
            $script:ChannelExtra["wechatcomapp_aes_key"]  = Read-Host (T "Enter WeChat Com App AES Key")
            $port = Read-Host ((T "Enter port") + " [" + (T "default") + ": 9898]")
            if (-not ($port -match '^\d+$')) { $port = "9898" }
            $script:ChannelExtra["wechatcomapp_port"] = [int]$port
            $script:AccessInfo = (T "WeCom App channel configured on port") + " $port"
        }
        "telegram" {
            $script:ChannelType = "telegram"
            Write-Clinicle (T "Configure Telegram...")
            $script:ChannelExtra["telegram_token"] = Read-Host (T "Enter Telegram Bot Token")
            $script:AccessInfo = T "Telegram channel configured"
        }
        "slack" {
            $script:ChannelType = "slack"
            Write-Clinicle (T "Configure Slack...")
            $script:ChannelExtra["slack_bot_token"] = Read-Host ((T "Enter Slack Bot Token") + " (xoxb-...)")
            $script:ChannelExtra["slack_app_token"] = Read-Host ((T "Enter Slack App Token") + " (xapp-...)")
            $script:AccessInfo = T "Slack channel configured"
        }
        "discord" {
            $script:ChannelType = "discord"
            Write-Clinicle (T "Configure Discord...")
            $script:ChannelExtra["discord_token"] = Read-Host (T "Enter Discord Bot Token")
            $script:AccessInfo = T "Discord channel configured"
        }
    }
}

# ── generate config.json ─────────────────────────────────────────
function New-ConfigFile {
    Write-Clinicle (T "Generating config.json...")

    $config = [ordered]@{
        channel_type              = if ($script:ChannelType) { $script:ChannelType } else { "web" }
        model                     = if ($script:ModelName)  { $script:ModelName }  else { "" }
        cow_lang                  = if ($script:InstallLang) { $script:InstallLang } else { "auto" }
        open_ai_api_key           = ""
        open_ai_api_base          = "https://api.openai.com/v1"
        claude_api_key            = ""
        claude_api_base           = "https://api.anthropic.com/v1"
        gemini_api_key            = ""
        gemini_api_base           = "https://generativelanguage.googleapis.com"
        zhipu_ai_api_key          = ""
        moonshot_api_key          = ""
        ark_api_key               = ""
        dashscope_api_key         = ""
        minimax_api_key           = ""
        mimo_api_key              = ""
        deepseek_api_key          = ""
        deepseek_api_base         = "https://api.deepseek.com/v1"
        # Leave ASR/TTS provider empty so the web console auto-suggests the
        # vendor whose API key is actually configured (e.g. LinkAI), instead
        # of always defaulting to OpenAI.
        voice_to_text             = ""
        text_to_voice             = ""
        voice_reply_voice         = $false
        speech_recognition        = $true
        group_speech_recognition  = $false
        use_linkai                = [bool]$script:UseLinkai
        linkai_api_key            = ""
        linkai_app_code           = ""
        agent                     = $true
        agent_max_context_tokens  = 50000
        agent_max_context_turns   = 20
        agent_max_steps           = 20
        # New installs opt into self-evolution (matches run.sh).
        self_evolution_enabled    = $true
    }

    # Set the API key into the right field (skipped models leave it empty).
    if ($script:ModelField -and $config.Contains($script:ModelField)) {
        $config[$script:ModelField] = $script:ApiKey
    }
    # Set API base if the model has a configurable base and the user changed it.
    if ($script:ApiBase -and $script:ApiBaseField -and $config.Contains($script:ApiBaseField)) {
        $config[$script:ApiBaseField] = $script:ApiBase
    }

    # Merge channel-specific fields
    foreach ($k in $script:ChannelExtra.Keys) {
        $config[$k] = $script:ChannelExtra[$k]
    }

    $jsonText = $config | ConvertTo-Json -Depth 5
    [System.IO.File]::WriteAllText("$BaseDir\config.json", $jsonText, (New-Object System.Text.UTF8Encoding $false))
    Write-Clinicle (T "Configuration file created.")
}

# Resolve the `clinicle` command, self-healing PATH if needed. When `clinicle`
# is missing (e.g. an older install whose PATH was never persisted), locate the
# Scripts dir, re-add it to PATH (session + persistent), and retry. Returns
# $true if callable.
function Resolve-CowCommand {
    if (Get-Command clinicle -ErrorAction SilentlyContinue) { return $true }

    $py = if ($PythonCmd) { $PythonCmd } else { Find-Python }
    if ($py) {
        $scriptsDir = & $py -c "import sysconfig; print(sysconfig.get_path('scripts'))" 2>$null
        if ($scriptsDir -and (Test-Path "$scriptsDir\clinicle.exe")) {
            Add-ScriptsDirToPath $scriptsDir
            if (Get-Command clinicle -ErrorAction SilentlyContinue) { return $true }
        }
    }
    return $false
}

# ── start via clinicle CLI ────────────────────────────────────────
function Start-ClinicleIntelligence {
    Write-Clinicle (T "Starting Clinicle Intelligence...")
    if (Resolve-CowCommand) {
        & clinicle start
    } else {
        Write-Warn (T "clinicle CLI not found, starting directly...")
        & $PythonCmd "$BaseDir\app.py"
    }
}

# ── delegate management commands to clinicle CLI ──────────────────
function Invoke-CowCommand {
    param([string]$Cmd)
    if (Resolve-CowCommand) {
        & clinicle $Cmd
    } else {
        # Fall back to the module entrypoint so management commands still work
        # even when clinicle.exe isn't on PATH (e.g. right after a fresh reboot
        # on an older install).
        $py = if ($PythonCmd) { $PythonCmd } else { Find-Python }
        if ($py -and (Test-Path "$BaseDir\app.py")) {
            Write-Warn (T "clinicle command not found, falling back to python -m cli.cli...")
            Push-Location $BaseDir
            try { & $py -m cli.cli $Cmd } finally { Pop-Location }
        } else {
            Write-Err (T "clinicle CLI not found. Run this script without arguments first to install.")
            exit 1
        }
    }
}

# ── usage ─────────────────────────────────────────────────────────
function Show-Usage {
    Write-Info "========================================="
    Write-Info "   Clinicle Intelligence Management Script (Windows)"
    Write-Info "========================================="
    Write-Host ""
    Write-Host (T "Usage:")
    Write-Host ("  .\run.ps1               # " + (T "Install / Configure"))
    Write-Host ("  .\run.ps1 <command>     # " + (T "Management command"))
    Write-Host ""
    Write-Host (T "Commands:")
    Write-Host ("  start      " + (T "Start the service"))
    Write-Host ("  stop       " + (T "Stop the service"))
    Write-Host ("  restart    " + (T "Restart the service"))
    Write-Host ("  status     " + (T "Check service status"))
    Write-Host ("  logs       " + (T "View logs"))
    Write-Host ("  config     " + (T "Reconfigure project"))
    Write-Host ("  update     " + (T "Update and restart"))
    Write-Host ("  help       " + (T "Show this message"))
    Write-Host ""
}

# ── install mode ──────────────────────────────────────────────────
function Install-Mode {
    Clear-Host
    Write-Info "========================================="
    Write-Info "   Clinicle Intelligence Installation (Windows)"
    Write-Info "========================================="
    Write-Host ""

    # Step 0: choose the install/UI language. Everything after this is localized.
    Select-Language
    Write-Host ""

    if ($IsProjectDir) {
        Write-Clinicle (T "Detected existing project directory.")
        if (Test-Path "$BaseDir\config.json") {
            Write-Clinicle (T "Project already configured.")
            Write-Host ""
            Show-Usage
            return
        }
        Write-Warn (T "No config.json found. Let's configure your project!")
        Write-Host ""
        Assert-Python
    } else {
        Assert-Python
        Install-Project
    }

    Install-Dependencies
    Select-Model
    Configure-Model
    $script:ChannelChoice = "web"
    Configure-Channel
    New-ConfigFile

    # Auto-start after configuration for a true out-of-the-box experience.
    Write-Host ""
    if ($script:AccessInfo) { Write-Clinicle $script:AccessInfo }
    Write-Warn (T "Tip: to let the Agent browse the web, run 'clinicle install-browser' to install the browser tool")
    Start-ClinicleIntelligence
}

# ── update ────────────────────────────────────────────────────────
function Update-Project {
    Write-Clinicle (T "Updating Clinicle Intelligence...")
    Set-Location $BaseDir

    # Stop if running
    $clinicleBin = Get-Command clinicle -ErrorAction SilentlyContinue
    if ($clinicleBin) {
        $prevEAP = $ErrorActionPreference; $ErrorActionPreference = "Continue"
        & clinicle stop 2>&1 | Out-Null
        $ErrorActionPreference = $prevEAP
    }

    if (Test-Path "$BaseDir\.git") {
        Write-Clinicle (T "Pulling latest code...")
        $prevEAP = $ErrorActionPreference; $ErrorActionPreference = "Continue"
        git pull 2>&1 | Out-Null
        $pullExit = $LASTEXITCODE
        $ErrorActionPreference = $prevEAP
        if ($pullExit -ne 0) {
            Write-Warn (T "GitHub failed, trying Gitee...")
            $ErrorActionPreference = "Continue"
            git remote set-url origin https://gitee.com/zhayujie/CowAgent.git 2>&1 | Out-Null
            git pull 2>&1 | Out-Null
            $ErrorActionPreference = $prevEAP
        }
    } else {
        Write-Warn (T "Not a git repository, skipping code update.")
    }

    Assert-Python
    Install-Dependencies

    # Start via python -m cli.cli instead of clinicle.exe, because the exe may
    # still be cached/locked from the previous installation on Windows.
    Write-Clinicle (T "Starting Clinicle Intelligence...")
    & $PythonCmd -m cli.cli start
}

# ── main ──────────────────────────────────────────────────────────
Initialize-UiLang

switch ($Command.ToLower()) {
    ""        { Install-Mode }
    "start"   { Invoke-CowCommand "start" }
    "stop"    { Invoke-CowCommand "stop" }
    "restart" { Invoke-CowCommand "restart" }
    "status"  { Invoke-CowCommand "status" }
    "logs"    { Invoke-CowCommand "logs" }
    "config"  {
        Assert-Python
        Install-Dependencies
        Select-Model
        Configure-Model
        $script:ChannelChoice = "web"
        Configure-Channel
        New-ConfigFile
        $r = Read-Host (T "Restart service now? [Y/n]")
        if ($r -ne "n" -and $r -ne "N") { Invoke-CowCommand "restart" }
    }
    "update"  { Update-Project }
    "help"    { Show-Usage }
    default   {
        Write-Err ((T "Unknown command") + ": $Command")
        Show-Usage
        exit 1
    }
}
