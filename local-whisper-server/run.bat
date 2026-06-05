@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "VENV_DIR=%SCRIPT_DIR%.venv"
set "PYTHON_EXE=%VENV_DIR%\Scripts\python.exe"
set "INSTALLED_PYTHON=%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
set "BASE_PYTHON="

if not exist "%PYTHON_EXE%" (
  where py >nul 2>nul
  if not errorlevel 1 (
    set "BASE_PYTHON=py -3"
  ) else (
    for /f "delims=" %%P in ('where python 2^>nul') do (
      echo %%P | findstr /I "\\WindowsApps\\python.exe" >nul
      if errorlevel 1 (
        if not defined BASE_PYTHON set "BASE_PYTHON=%%P"
      )
    )
  )

  if not defined BASE_PYTHON (
    if exist "%INSTALLED_PYTHON%" (
      set "BASE_PYTHON=%INSTALLED_PYTHON%"
    )
  )

  if not defined BASE_PYTHON (
    echo Python was not found. Install Python 3.10+ and run this again.
    exit /b 1
  )

  if "%BASE_PYTHON%"=="py -3" (
    py -3 -m venv "%VENV_DIR%"
  ) else (
    "%BASE_PYTHON%" -m venv "%VENV_DIR%"
  )
)

if not exist "%PYTHON_EXE%" (
  echo Failed to create the Python virtual environment at "%VENV_DIR%".
  exit /b 1
)

"%PYTHON_EXE%" -m pip install --upgrade pip
"%PYTHON_EXE%" -m pip install -r "%SCRIPT_DIR%requirements.txt"
"%PYTHON_EXE%" "%SCRIPT_DIR%server.py" --model base
