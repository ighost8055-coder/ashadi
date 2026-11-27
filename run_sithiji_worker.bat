@echo off
rem Sithiji PC worker: analyses queued content from the VPS and carries "Send to Ashadi" cards. Hidden (pythonw); log: sithiji\data\worker.log
cd /d "%~dp0"
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
set PYW=C:\Users\fari\AppData\Local\Python\pythoncore-3.14-64\pythonw.exe
if not exist "%PYW%" set PYW=pythonw
start "" "%PYW%" sithiji\worker_pc.py
