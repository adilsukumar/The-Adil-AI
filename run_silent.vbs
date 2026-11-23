' Adil AI - 100% Invisible Background Autopilot Launcher
' Starts pythonw without spawning CMD or any console window
Dim WshShell, fso, currentDir, pythonwPath

Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
currentDir = fso.GetParentFolderName(WScript.ScriptFullName)

' Check if local virtualenv has pythonw.exe, otherwise use system pythonw
If fso.FileExists(currentDir & "\.venv\Scripts\pythonw.exe") Then
    pythonwPath = """" & currentDir & "\.venv\Scripts\pythonw.exe"""
Else
    pythonwPath = "pythonw"
End If

' Launch completely hidden (Window Style 0 = Hidden, WaitOnReturn = False)
WshShell.CurrentDirectory = currentDir
WshShell.Run pythonwPath & " """ & currentDir & "\main.py""", 0, False

' Play soft starting chime (1000Hz, 80ms)
WshShell.Run "powershell -c [console]::beep(1000, 80)", 0, True
