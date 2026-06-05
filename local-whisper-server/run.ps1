$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$VenvDir = Join-Path $ScriptDir ".venv"
$PythonExe = Join-Path $VenvDir "Scripts\python.exe"
$InstalledPython = Join-Path $env:LOCALAPPDATA "Programs\Python\Python312\python.exe"

if (-not (Test-Path $PythonExe)) {
  $SystemPython = Get-Command py -ErrorAction SilentlyContinue
  $PlainPython = Get-Command python -ErrorAction SilentlyContinue

  if ($SystemPython) {
    & py -3 -m venv $VenvDir
  } elseif ($PlainPython -and $PlainPython.Source -notlike "*WindowsApps*") {
    & python -m venv $VenvDir
  } elseif (Test-Path $InstalledPython) {
    & $InstalledPython -m venv $VenvDir
  } else {
    throw "Python was not found. Install Python 3.10+ or update run.ps1 with a Python path."
  }
}

& $PythonExe -m pip install --upgrade pip
& $PythonExe -m pip install -r (Join-Path $ScriptDir "requirements.txt")
& $PythonExe (Join-Path $ScriptDir "server.py") --model base
